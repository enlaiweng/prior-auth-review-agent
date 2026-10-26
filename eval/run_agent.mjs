// Run the agent on a set of cases and save one decision per case, plus a record of the run.
// Run by the "Agent run" workflow; it needs the key in ANTHROPIC_API_KEY and never prints it.
//
// Usage (from the repository root):
//   node eval/run_agent.mjs --cases smoke|dev|nine|all12|case_01,case_03 --budget experiments|release --out DIR [--checklist]
//
// Case sets: smoke is the throwaway test case data/smoke/case_00; dev is eval/dev_subset.txt; nine is the twelve golden
// cases minus the held-out ones (HELD_OUT below, checked against docs/EVAL_PLAN.md on every run); all12 is every
// golden case.
// Budget rules (eval/README.md): the experiments budget runs only the smoke case and the cases in eval/dev_subset.txt,
// so it can never touch a held-out case. The release budget runs anything, but held-out cases only as part of all12.
// Labels-first rule: no golden case runs before its final labels (labels.yaml) are merged on main, so the agent's view of
// a case can never reach the owner before he has labeled it and settled its labels.
// Writes DIR/<case>.json (the decision) and DIR/run.json (settings, agent version, fingerprints, tokens, cost estimate).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { reviewCase, SETTINGS, AGENT_VERSION } from "../agent/agent.js";
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

export function checkHeldOutMatchesPlan() {
  const plan = readFileSync("docs/EVAL_PLAN.md", "utf8");
  const expected = PLAN_SENTENCE.match(/cases (\d\d), (\d\d), and (\d\d)/).slice(1).map(n => `case_${n}`);
  if (!plan.includes(PLAN_SENTENCE) || JSON.stringify(expected) !== JSON.stringify(HELD_OUT)) {
    throw new Error("the held-out list in eval/run_agent.mjs does not match docs/EVAL_PLAN.md; nothing was run");
  }
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
  else ids = spec.split(",").map(s => s.trim()).filter(Boolean);
  return ids.map(id => ({ id, dir: id === "case_00" ? "data/smoke/case_00" : `data/golden/${id}`, heldOut: held.has(id) }));
}

// Throws with a plain message when a case set is not allowed on a budget.
export function checkBudget(cases, budget, spec) {
  if (budget === "experiments") {
    const allowed = new Set(["case_00", ...lines("eval/dev_subset.txt")]);
    const bad = cases.filter(c => !allowed.has(c.id) || c.heldOut);
    if (bad.length) throw new Error(`the experiments budget runs only the smoke case and eval/dev_subset.txt; not allowed: ${bad.map(c => c.id).join(", ")}`);
  } else if (budget === "release") {
    const held = cases.filter(c => c.heldOut);
    if (held.length && spec !== "all12") throw new Error(`held-out cases run only as part of all12 (release evaluation and vendor-update run); not allowed here: ${held.map(c => c.id).join(", ")}`);
  } else {
    throw new Error(`unknown budget ${budget}; use experiments or release`);
  }
  for (const c of cases) if (!existsSync(`${c.dir}/bundle.json`)) throw new Error(`no bundle for ${c.id} at ${c.dir}`);
  const unlabeled = cases.filter(c => c.id !== "case_00" && !onMain(`${c.dir}/labels.yaml`));
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
  const a = { cases: "smoke", budget: "experiments", out: null, checklist: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cases") a.cases = argv[++i];
    else if (argv[i] === "--budget") a.budget = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--checklist") a.checklist = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  checkHeldOutMatchesPlan();
  const cases = resolveCases(a.cases);
  checkBudget(cases, a.budget, a.cases);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const out = a.out || `eval/runs/local-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  mkdirSync(out, { recursive: true });
  let commit = null;
  try { commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const run = {
    agent_version: AGENT_VERSION, spec_sha256: SPEC_SHA256, settings: SETTINGS, budget: a.budget, case_set: a.cases,
    checklist_mode: a.checklist, git_commit: commit, workflow_run: process.env.RUN_URL || null,
    started_utc: new Date().toISOString(), cases: {},
  };
  console.log(`${AGENT_VERSION} (spec ${SPEC_SHA256.slice(0, 12)}), ${SETTINGS.model}, effort ${SETTINGS.effort}; ${cases.length} case(s) on the ${a.budget} budget`);
  for (const c of cases) {
    const bundle = JSON.parse(readFileSync(`${c.dir}/bundle.json`, "utf8"));
    const d = await reviewCase(bundle, { apiKey, caseId: c.id, approveEnabled: !a.checklist, ...testServer() });
    writeFileSync(`${out}/${c.id}.json`, JSON.stringify(d, null, 1) + "\n");
    const cost = costUsd(SETTINGS.model, d.usage);
    run.cases[c.id] = { routing: d.routing, named_gap: d.named_gap, error: d.error, model_returned: d.model.returned,
                        stop_reason: d.stop_reason, usage: d.usage, cost_usd_estimate: cost, seconds: d.seconds, attempts: d.attempts };
    const u = d.usage || {};
    console.log(`${c.id}: ${d.routing}${d.named_gap ? ` (gap on ${d.named_gap.criterion})` : ""}${d.error ? `; ERROR ${d.error}` : ""}; ` +
                `tokens in ${u.input_tokens ?? "?"} + cache ${(u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)}, out ${u.output_tokens ?? "?"}; ` +
                `about $${cost ?? "?"}; ${d.seconds} s`);
  }
  const all = Object.values(run.cases);
  run.finished_utc = new Date().toISOString();
  run.models_returned = [...new Set(all.map(x => x.model_returned))];
  run.errors = Object.entries(run.cases).filter(([, x]) => x.error).map(([id]) => id);
  run.cost_usd_estimate_total = Math.round(all.reduce((s, x) => s + (x.cost_usd_estimate || 0), 0) * 10000) / 10000;
  writeFileSync(`${out}/run.json`, JSON.stringify(run, null, 1) + "\n");
  console.log(`done: ${all.length} case(s), ${run.errors.length} error(s), about $${run.cost_usd_estimate_total} in total; written to ${out}`);
  if (run.errors.length) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error("stopped: " + e.message); process.exit(1); });
}
