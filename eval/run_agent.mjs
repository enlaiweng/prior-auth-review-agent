// Run the agent on a set of cases and save one decision per case, plus a record of the run.
// Run by the "Agent run" workflow; it needs the key in ANTHROPIC_API_KEY and never prints it.
//
// Usage (from the repository root):
//   node eval/run_agent.mjs --cases smoke|dev|nine|all12|pairs|injection|case_01,case_03 --budget experiments|release
//        --out DIR [--checklist] [--variant no-notes|no-instruction] [--model vendor-update]
//
// Case sets: smoke is the throwaway test case data/smoke/case_00; dev is eval/dev_subset.txt; nine is the twelve golden
// cases minus the held-out ones (HELD_OUT below, checked against docs/EVAL_PLAN.md on every run); all12 is every
// golden case; pairs is the two paired fairness duplicates (PAIRS); injection is the two cases whose notes carry an
// instruction to the reviewer (eval/instruction_sentences.json).
// The release evaluation's side checks (docs/EVAL_PLAN.md; eval/README.md, rule 10) change what the agent is given,
// never the agent: --variant no-notes replaces every visit note with one sentence saying none was submitted;
// --variant no-instruction takes the sentence that addresses the reviewer out of the note; --model vendor-update
// sends the same request to the newer model version the plan names.
// Budget rules (eval/README.md): the experiments budget runs only the smoke case and the cases in eval/dev_subset.txt,
// so it can never touch a held-out case; a variant or the newer model runs there on the smoke case only, as a
// rehearsal. The release budget runs anything, but held-out cases only as part of all12, and only after the freeze:
// the tag FREEZE_TAG exists and the agent's spec is the one it holds.
// Labels-first rule: no golden case runs before its final labels (labels.yaml) are merged on main, so the agent's view of
// a case can never reach the owner before he has labeled it and settled its labels.
// Writes DIR/<case>.json (the decision) and DIR/run.json (settings, agent version, fingerprints, tokens, cost estimate).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { reviewCase, SETTINGS, AGENT_VERSION } from "../agent/agent.js";
import { readCase } from "../agent/record.js";
import { SPEC_SHA256 } from "../agent/spec.generated.js";

// Published prices for claude-sonnet-5, US dollars per million tokens (platform.claude.com/docs/en/about-claude/pricing,
// checked 2026-10-16). Used only for the cost estimate in run.json.
const PRICES = {
  "claude-sonnet-5": { input: 2, output: 10, cache_write_5m: 2.5, cache_read: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_write_5m: 2.5, cache_read: 0.1 },
};

// The held-out cases (docs/EVAL_PLAN.md, Golden set composition). Written here rather than read from a file a branch could
// change, and checked against the plan's own sentence before every run.
export const HELD_OUT = ["case_08", "case_10", "case_12"];
const PLAN_SENTENCE = "Held-out cases, 3 of the 12: cases 08, 10, and 12.";

// The paired fairness duplicates and the case each one copies (docs/EVAL_PLAN.md, Paired fairness checks). A pair has
// no labels of its own: it shares its original's.
export const PAIRS = { case_01_pair_sex: "case_01", case_09_pair_race: "case_09" };
// The newer model version of the vendor-update run (docs/EVAL_PLAN.md, Vendor-update re-evaluation).
export const VENDOR_UPDATE_MODEL = "claude-sonnet-5-5";
// The tag the owner creates at the freeze. Held-out cases run only on the agent it holds.
export const FREEZE_TAG = "v1.0-freeze";
// What a case's note says in the no-notes run (docs/EVAL_PLAN.md, Ablation).
export const NO_NOTE_TEXT = "No visit note was submitted with this request.";
const VARIANTS = ["no-notes", "no-instruction"];

// The sentence in each instruction-bearing note that addresses the reviewer, one paragraph of its own.
export function instructionSentences() {
  return JSON.parse(readFileSync("eval/instruction_sentences.json", "utf8"));
}

export function checkHeldOutMatchesPlan() {
  const plan = readFileSync("docs/EVAL_PLAN.md", "utf8");
  const expected = PLAN_SENTENCE.match(/cases (\d\d), (\d\d), and (\d\d)/).slice(1).map(n => `case_${n}`);
  if (!plan.includes(PLAN_SENTENCE) || JSON.stringify(expected) !== JSON.stringify(HELD_OUT)) {
    throw new Error("the held-out list in eval/run_agent.mjs does not match docs/EVAL_PLAN.md; nothing was run");
  }
  if (!plan.includes(`is run on a newer model version, ${VENDOR_UPDATE_MODEL} `)) {
    throw new Error("the vendor-update model in eval/run_agent.mjs does not match docs/EVAL_PLAN.md; nothing was run");
  }
  if (!plan.includes("The two instruction-bearing notes (cases 09 and 11)") ||
      JSON.stringify(Object.keys(instructionSentences()).sort()) !== JSON.stringify(["case_09", "case_11"])) {
    throw new Error("eval/instruction_sentences.json does not match the instruction-bearing notes in docs/EVAL_PLAN.md; nothing was run");
  }
}

// Why the held-out cases may not run yet, or null when they may: the freeze tag exists and holds this very agent.
// Anything else on main may have changed since the tag (documents, this script); the agent may not.
export function freezeProblem(specAtTag = () => execSync(`git show ${FREEZE_TAG}:agent/spec.generated.js`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) {
  let text;
  try { text = specAtTag(); } catch { return `the held-out cases run only after the freeze, and the tag ${FREEZE_TAG} does not exist yet`; }
  const m = /SPEC_SHA256 = "([0-9a-f]{64})"/.exec(text);
  if (!m || m[1] !== SPEC_SHA256) return `the agent has changed since the freeze (tag ${FREEZE_TAG}); the held-out cases run only on the frozen agent`;
  return null;
}

// The bundle as a variant gives it to the agent. The note is rewritten here, before the agent's own input step.
export function applyVariant(bundle, variant, caseId) {
  if (!variant) return bundle;
  const copy = JSON.parse(JSON.stringify(bundle));
  const docs = copy.entry.map(e => e.resource).filter(r => r.resourceType === "DocumentReference");
  if (docs.length !== 1) throw new Error(`${caseId}: expected exactly one DocumentReference, found ${docs.length}`);
  const att = docs[0].content[0].attachment;
  let text;
  if (variant === "no-notes") {
    text = NO_NOTE_TEXT + "\n";
  } else if (variant === "no-instruction") {
    const sentence = instructionSentences()[caseId];
    if (!sentence) throw new Error(`${caseId}: no instruction sentence is recorded in eval/instruction_sentences.json`);
    const paragraphs = Buffer.from(att.data, "base64").toString("utf8").trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const hits = paragraphs.filter(p => p === sentence).length;
    if (hits !== 1) throw new Error(`${caseId}: the instruction sentence must be one whole paragraph of the note, exactly once; found ${hits}`);
    if (paragraphs[paragraphs.length - 1] !== sentence) throw new Error(`${caseId}: the instruction sentence must be the note's last paragraph, so the other paragraphs keep their numbers`);
    text = paragraphs.slice(0, -1).join("\n\n") + "\n";
  } else {
    throw new Error(`unknown variant ${variant}; use ${VARIANTS.join(" or ")}`);
  }
  att.data = Buffer.from(text, "utf8").toString("base64");
  return copy;
}

// Whether a file is on main (the remote branch), not just on the branch being run.
function onMain(path) {
  try { execSync(`git cat-file -e origin/main:${path}`, { stdio: "ignore" }); return true; } catch { return false; }
}

function lines(path) {
  return readFileSync(path, "utf8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
}

export function goldenCases() {
  return readdirSync("data/golden").filter(d => /^case_\d\d$/.test(d)).sort();
}

export function resolveCases(spec) {
  const held = new Set(HELD_OUT);
  const golden = goldenCases();
  let ids;
  if (spec === "smoke") ids = ["case_00"];
  else if (spec === "dev") ids = lines("eval/dev_subset.txt");
  else if (spec === "nine") ids = golden.filter(c => !held.has(c));
  else if (spec === "all12") ids = golden;
  else if (spec === "pairs") ids = Object.keys(PAIRS);
  else if (spec === "injection") ids = Object.keys(instructionSentences()).sort();
  else ids = spec.split(",").map(s => s.trim()).filter(Boolean);
  return ids.map(id => ({ id, dir: id === "case_00" ? "data/smoke/case_00" : `data/golden/${id}`, heldOut: held.has(id),
                          labelsDir: `data/golden/${PAIRS[id] || id}` }));
}

// Throws with a plain message when a case set is not allowed on a budget.
export function checkBudget(cases, budget, spec, { variant = null, vendorUpdate = false, frozen = freezeProblem } = {}) {
  if (variant && !VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}; use ${VARIANTS.join(" or ")}`);
  if (budget === "experiments") {
    const allowed = new Set(["case_00", ...lines("eval/dev_subset.txt")]);
    const bad = cases.filter(c => !allowed.has(c.id) || c.heldOut);
    if (bad.length) throw new Error(`the experiments budget runs only the smoke case and eval/dev_subset.txt; not allowed: ${bad.map(c => c.id).join(", ")}`);
    if ((variant || vendorUpdate) && cases.some(c => c.id !== "case_00")) {
      throw new Error("on the experiments budget, a variant or the vendor-update model runs on the smoke case only, as a rehearsal");
    }
  } else if (budget === "release") {
    const held = cases.filter(c => c.heldOut);
    if (held.length && spec !== "all12") throw new Error(`held-out cases run only as part of all12 (release evaluation and vendor-update run); not allowed here: ${held.map(c => c.id).join(", ")}`);
    const problem = held.length ? frozen() : null;
    if (problem) throw new Error(`${problem}; nothing was run`);
  } else {
    throw new Error(`unknown budget ${budget}; use experiments or release`);
  }
  for (const c of cases) if (!existsSync(`${c.dir}/bundle.json`)) throw new Error(`no bundle for ${c.id} at ${c.dir}`);
  const unlabeled = cases.filter(c => c.id !== "case_00" && !onMain(`${c.labelsDir}/labels.yaml`));
  if (unlabeled.length) throw new Error(`no golden case runs before its final labels are merged on main; missing for: ${unlabeled.map(c => c.id).join(", ")}`);
}

export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const cost = ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output +
    (usage.cache_creation_input_tokens || 0) * p.cache_write_5m + (usage.cache_read_input_tokens || 0) * p.cache_read) / 1e6;
  return Math.round(cost * 10000) / 10000;
}

// Tests only: point the agent at a fake model on this computer. Accepted only for a plain http address on 127.0.0.1
// with no user name or password, checked by parsing: "http://127.0.0.1:@elsewhere.example/" has the host
// elsewhere.example and is ignored, so the key can't be sent anywhere but Anthropic.
export function localTestUrl(value) {
  if (typeof value !== "string" || !value) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password) return null;
  return u.href;
}
function testServer() {
  const u = localTestUrl(process.env.AGENT_TEST_API_URL);
  return u ? { apiUrl: u } : {};
}

function args(argv) {
  const a = { cases: "smoke", budget: "experiments", out: null, checklist: false, variant: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cases") a.cases = argv[++i];
    else if (argv[i] === "--budget") a.budget = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--checklist") a.checklist = true;
    else if (argv[i] === "--variant") a.variant = argv[++i];
    else if (argv[i] === "--model") a.model = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  checkHeldOutMatchesPlan();
  if (a.model !== null && a.model !== "vendor-update") throw new Error(`unknown model choice ${a.model}; the only one is vendor-update`);
  const vendorUpdate = a.model === "vendor-update";
  // The same named settings on the newer model (agent/README.md, Settings); nothing else about the request changes.
  const settings = vendorUpdate ? { ...SETTINGS, model: VENDOR_UPDATE_MODEL } : SETTINGS;
  const cases = resolveCases(a.cases);
  checkBudget(cases, a.budget, a.cases, { variant: a.variant, vendorUpdate });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const out = a.out || `eval/runs/local-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  mkdirSync(out, { recursive: true });
  let commit = null;
  try { commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const run = {
    agent_version: AGENT_VERSION, spec_sha256: SPEC_SHA256, settings, budget: a.budget, case_set: a.cases,
    variant: a.variant, vendor_update: vendorUpdate, checklist_mode: a.checklist, git_commit: commit, workflow_run: process.env.RUN_URL || null,
    started_utc: new Date().toISOString(), cases: {},
  };
  console.log(`${AGENT_VERSION} (spec ${SPEC_SHA256.slice(0, 12)}), ${settings.model}, effort ${settings.effort}; ${cases.length} case(s) on the ${a.budget} budget` +
              (a.variant ? `; variant ${a.variant}` : ""));
  // run.json is rewritten after every case, so a run that stops partway (a timeout, a cancelled job) still leaves a
  // record matching the decisions written so far. finished_utc and the totals are added only when every case is done.
  const saveRun = () => writeFileSync(`${out}/run.json`, JSON.stringify(run, null, 1) + "\n");
  for (const [i, c] of cases.entries()) {
    console.log(`${c.id}: sending (${i + 1} of ${cases.length})`);
    const bundle = applyVariant(JSON.parse(readFileSync(`${c.dir}/bundle.json`, "utf8")), a.variant, c.id);
    const d = await reviewCase(bundle, { apiKey, caseId: c.id, approveEnabled: !a.checklist, settings, ...testServer() });
    writeFileSync(`${out}/${c.id}.json`, JSON.stringify(d, null, 1) + "\n");
    const cost = costUsd(settings.model, d.usage);
    // How many note paragraphs the agent was shown: a variant changes the note, and eval/score.py checks cited
    // paragraph ids against the note as given, not as stored.
    let shown = null;
    try { shown = readCase(bundle).paragraphs.length; } catch { /* a bundle the agent could not read: the decision says so */ }
    run.cases[c.id] = { routing: d.routing, named_gap: d.named_gap, error: d.error, model_returned: d.model.returned,
                        stop_reason: d.stop_reason, usage: d.usage, cost_usd_estimate: cost, seconds: d.seconds, attempts: d.attempts,
                        note_paragraphs: shown };
    const u = d.usage || {};
    console.log(`${c.id}: ${d.routing}${d.named_gap ? ` (gap on ${d.named_gap.criterion})` : ""}${d.error ? `; ERROR ${d.error}` : ""}; ` +
                `tokens in ${u.input_tokens ?? "?"} + cache ${(u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)}, out ${u.output_tokens ?? "?"}; ` +
                `about $${cost ?? "?"}; ${d.seconds} s`);
    saveRun();
  }
  const all = Object.values(run.cases);
  run.finished_utc = new Date().toISOString();
  run.models_returned = [...new Set(all.map(x => x.model_returned))];
  run.errors = Object.entries(run.cases).filter(([, x]) => x.error).map(([id]) => id);
  run.cost_usd_estimate_total = Math.round(all.reduce((s, x) => s + (x.cost_usd_estimate || 0), 0) * 10000) / 10000;
  saveRun();
  console.log(`done: ${all.length} case(s), ${run.errors.length} error(s), about $${run.cost_usd_estimate_total} in total; written to ${out}`);
  if (run.errors.length) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error("stopped: " + e.message); process.exit(1); });
}
