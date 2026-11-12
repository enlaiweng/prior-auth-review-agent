#!/bin/bash
# Run the agent and score the result: the body of the "Agent run" workflow, kept here so both of its jobs run the same
# steps. Run from the repository root:
#   bash eval/run_and_score.sh BUDGET CASES RUNS CHECKLIST
# BUDGET is experiments or release; CASES is smoke, dev, nine, all12, release-evaluation, vendor-update, or rehearsal;
# RUNS is how many runs in a row; CHECKLIST is true to turn the approve output off. The key comes from ANTHROPIC_API_KEY.
# release-evaluation (release budget, after the freeze; docs/EVAL_PLAN.md; eval/README.md, rule 10) is the whole
# release evaluation in one go, RUNS ignored: three runs on all 12, the two fairness pairs, one run on all 12 with the
# notes removed, the two instruction-bearing cases with that sentence taken out, and all 12 on the vendor-update model.
# vendor-update (release budget, after the freeze) is that last part by itself, for when it has to be run again.
# rehearsal (experiments budget) tries the same machinery on the smoke case only: as it is, without its note, and on
# the vendor-update model.
# Writes eval/runs/NAME/ for each run (decisions, run.json, score.json, score.md); for release-evaluation and rehearsal
# also eval/runs/NAME_summary.md, the runs read together (eval/release_summary.py). Lists what it wrote in the file
# named by RUN_LIST (default: run_folders.txt in the runner's temporary folder).
# Exit code 0 even when a case failed: the failure is in the decision and the score.
set -euo pipefail
budget="$1"; cases="$2"; runs="$3"; checklist="$4"
case "$budget" in experiments|release) ;; *) echo "unknown budget: $budget"; exit 1 ;; esac
case "$cases" in smoke|dev|nine|all12|release-evaluation|vendor-update|rehearsal) ;; *) echo "unknown case set: $cases"; exit 1 ;; esac
case "$runs" in 1|2|3) ;; *) echo "runs must be 1, 2, or 3"; exit 1 ;; esac
case "$checklist" in true|false) ;; *) echo "checklist must be true or false"; exit 1 ;; esac

# On the experiments budget, the files that say which cases may run must be the ones on main, so a branch cannot widen
# them for itself (eval/README.md, rules 1 and 5).
if [ "$budget" = "experiments" ]; then
  for f in eval/dev_subset.txt docs/EVAL_PLAN.md; do
    if ! git diff --quiet origin/main -- "$f"; then echo "stopped: $f differs from main; experiments run only with main's case lists"; exit 1; fi
  done
fi

version=$(node -e 'import("./agent/agent.js").then(m => console.log(m.AGENT_VERSION))')
stamp=$(date -u +%Y-%m-%d)
flag=""; mode=""; [ "$checklist" = "true" ] && flag="--checklist" && mode="_checklist"
list="${RUN_LIST:-${RUNNER_TEMP:-/tmp}/run_folders.txt}"
mkdir -p eval/runs
: > "$list"
# The plan: one line per part, as "case set | extra options for eval/run_agent.mjs | name suffix | how many runs".
if [ "$cases" = "release-evaluation" ]; then
  [ "$budget" = "release" ] || { echo "stopped: the release evaluation runs only on the release budget"; exit 1; }
  plan="all12||_|3
pairs||_|1
all12|--variant no-notes|-no-notes|1
injection|--variant no-instruction|-no-instruction|1
all12|--model vendor-update|-vendor-update|1"
elif [ "$cases" = "vendor-update" ]; then
  [ "$budget" = "release" ] || { echo "stopped: the vendor-update run uses the release budget"; exit 1; }
  plan="all12|--model vendor-update|-vendor-update|1"
elif [ "$cases" = "rehearsal" ]; then
  [ "$budget" = "experiments" ] || { echo "stopped: the rehearsal runs only on the experiments budget"; exit 1; }
  plan="smoke||_|1
smoke|--variant no-notes|-no-notes|1
smoke|--model vendor-update|-vendor-update|1"
else
  plan="${cases}||_|${runs}"
fi
while IFS='|' read -r set options suffix count; do
 [ "$suffix" = "_" ] && suffix=""
 base="${stamp}_${version}_${set}${suffix}_${budget}_run-${GITHUB_RUN_ID:-local}${mode}"
 for i in $(seq 1 "$count"); do
  out="eval/runs/${base}"
  [ "$count" != "1" ] && out="${out}_${i}-of-${count}"
  runs="$count"
  echo "== run $i of $runs: $out"
  node eval/run_agent.mjs --cases "$set" --budget "$budget" --out "$out" $flag $options < /dev/null || [ $? -eq 2 ]
  python3 eval/score.py "$out" > /dev/null
  echo "$out" >> "$list"
  # One notice per case in the run's log and check annotations: the decision in brief, readable without downloading
  # the artifact. Decisions carry no keys; for golden cases they appear only after the blind labels are in.
  node eval/print_notices.mjs "$out" || echo "(the notices for $out could not be printed; its files are complete)"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## ${out}"; echo
      node -e 'const r=require("./'"$out"'/run.json"); console.log(`Agent ${r.agent_version}, spec ${r.spec_sha256.slice(0,12)}; model asked for ${r.settings.model}, returned ${r.models_returned.join(", ")}; effort ${r.settings.effort}, thinking ${r.settings.thinking.type}, max tokens ${r.settings.max_tokens}. Cost estimate $${r.cost_usd_estimate_total}. Errors: ${r.errors.length ? r.errors.join(", ") : "none"}.`)'
      echo; sed 1,2d "$out/score.md"; echo
    } >> "$GITHUB_STEP_SUMMARY"
  fi
done
done <<EOF
$plan
EOF

# The runs read together (eval/README.md, rule 10): one page beside the run folders, also shown in the run's summary
# and its log.
if [ "$cases" = "release-evaluation" ] || [ "$cases" = "rehearsal" ]; then
  page="eval/runs/${stamp}_${version}_${cases}_${budget}_run-${GITHUB_RUN_ID:-local}${mode}_summary.md"
  # The page is a reading aid. If it cannot be made, the runs themselves are still delivered: a release evaluation
  # runs once, and nothing after the runs may cost their results.
  # shellcheck disable=SC2046
  if python3 eval/release_summary.py $(cat "$list") > "$page.tmp"; then
    mv "$page.tmp" "$page"
    echo "$page" >> "$list"
    cat "$page"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$page" >> "$GITHUB_STEP_SUMMARY"; fi
  else
    rm -f "$page.tmp"
    echo "::warning title=No summary page::eval/release_summary.py could not read these runs together; each run's own results are complete and are delivered as they are."
  fi
fi
