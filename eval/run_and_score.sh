#!/bin/bash
# Run the agent and score the result: the body of the "Agent run" workflow, kept here so both of its jobs run the same
# steps. Run from the repository root:
#   bash eval/run_and_score.sh BUDGET CASES RUNS CHECKLIST
# BUDGET is experiments or release; CASES is smoke, dev, nine, or all12; RUNS is how many runs in a row (3 for the
# release evaluation); CHECKLIST is true to turn the approve output off. The key comes from ANTHROPIC_API_KEY.
# Writes eval/runs/NAME/ for each run (decisions, run.json, score.json, score.md), and lists the folders it wrote in
# the file named by RUN_LIST (default: run_folders.txt in the runner's temporary folder). Exit code 0 even when a case failed: the failure is in the decision and the score.
set -euo pipefail
budget="$1"; cases="$2"; runs="$3"; checklist="$4"
case "$budget" in experiments|release) ;; *) echo "unknown budget: $budget"; exit 1 ;; esac
case "$cases" in smoke|dev|nine|all12) ;; *) echo "unknown case set: $cases"; exit 1 ;; esac
case "$runs" in 1|2|3) ;; *) echo "runs must be 1, 2, or 3"; exit 1 ;; esac
case "$checklist" in true|false) ;; *) echo "checklist must be true or false"; exit 1 ;; esac

version=$(node -e 'import("./agent/agent.js").then(m => console.log(m.AGENT_VERSION))')
stamp=$(date -u +%Y-%m-%d)
base="${stamp}_${version}_${cases}_${budget}_run-${GITHUB_RUN_ID:-local}"
flag=""; [ "$checklist" = "true" ] && flag="--checklist" && base="${base}_checklist"
list="${RUN_LIST:-${RUNNER_TEMP:-/tmp}/run_folders.txt}"
mkdir -p eval/runs
: > "$list"
for i in $(seq 1 "$runs"); do
  out="eval/runs/${base}"
  [ "$runs" != "1" ] && out="${out}_${i}-of-${runs}"
  echo "== run $i of $runs: $out"
  node eval/run_agent.mjs --cases "$cases" --budget "$budget" --out "$out" $flag || [ $? -eq 2 ]
  python3 eval/score.py "$out" > /dev/null
  echo "$out" >> "$list"
  # One notice per case in the run's log and check annotations: the decision in brief, readable without downloading
  # the artifact. Decisions carry no keys; for golden cases they appear only after the blind labels are in.
  node eval/print_notices.mjs "$out"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## ${out}"; echo
      node -e 'const r=require("./'"$out"'/run.json"); console.log(`Agent ${r.agent_version}, spec ${r.spec_sha256.slice(0,12)}; model asked for ${r.settings.model}, returned ${r.models_returned.join(", ")}; effort ${r.settings.effort}, thinking ${r.settings.thinking.type}, max tokens ${r.settings.max_tokens}. Cost estimate $${r.cost_usd_estimate_total}. Errors: ${r.errors.length ? r.errors.join(", ") : "none"}.`)'
      echo; sed 1,2d "$out/score.md"; echo
    } >> "$GITHUB_STEP_SUMMARY"
  fi
done
