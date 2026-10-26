// The demo's re-decision of stored decisions (demo/src/decide.js) must agree with the agent itself, and the build
// (demo/build_demo.py) must refuse what it should. No Worker, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reviewCase, AGENT_VERSION } from "../../agent/agent.js";
import { SPEC_SHA256 } from "../../agent/spec.generated.js";
import { redecide } from "../src/decide.js";
import { ROOT, finalLabels, reportFrom } from "./local-demo.mjs";

const CASES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(n => "case_" + n);
const bundle = id => JSON.parse(readFileSync(join(ROOT, "data/golden", id, "bundle.json"), "utf8"));
const fetchFor = report => async () => new Response(JSON.stringify({ model: "fake", stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(report) }], usage: {} }), { status: 200 });

// Reports of every shape the rule handles: approvable, a request, a red flag left open, a contradiction, a cited id
// that isn't in the case, and everything undeterminable.
function variants(id) {
  const labeled = ["case_05", "case_07"].includes(id) ? finalLabels("case_01") : finalLabels(id);
  const ids = Object.values(labeled).flatMap(c => c.evidence);
  const all = s => Object.fromEntries(Object.keys(labeled).map(k => [k, { status: s, evidence: [] }]));
  return [
    reportFrom(labeled),
    reportFrom({ ...labeled, C4_no_duplicate_imaging: { status: "undeterminable", evidence: [] } }, { missing: { criterion: "C4", missing: "the earlier imaging report" } }),
    reportFrom({ ...labeled, C1_red_flag: { status: "undeterminable", evidence: ["note:p1"] } }),
    reportFrom(labeled, { contradictions: [{ criterion: "C2", description: "d", evidence: ids.slice(0, 1) }] }),
    reportFrom({ ...labeled, C3_informs_management: { status: "supported", evidence: ["Procedure/not-in-this-case"] } }),
    reportFrom(all("undeterminable"), { missing: { criterion: "C3", missing: "the plan" } }),
  ];
}

test("re-deciding a stored report gives the agent's own outcome, for every case, report shape, and mode", async () => {
  let n = 0;
  const seen = new Set();
  for (const id of CASES) {
    const b = bundle(id);
    for (const report of variants(id)) {
      for (const approveEnabled of [true, false]) {
        const d = await reviewCase(b, { apiKey: "k", caseId: id, approveEnabled, fetchImpl: fetchFor(report), sleep: async () => {} });
        assert.equal(d.error, null, `${id}: ${d.error}`);
        const r = redecide(b, d, approveEnabled);
        for (const k of ["routing", "named_gap", "basis", "routing_reasons", "invalid_evidence", "invalid_policy_passages"])
          assert.deepEqual(r[k], d[k === "routing_reasons" ? "routing_reasons" : k], `${id} ${k} (approve ${approveEnabled})`);
        assert.equal(r.checklist_mode, !approveEnabled);
        seen.add(d.routing); n++;
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["approve", "request", "route"], "the variants reach all three outcomes");
  assert.equal(n, 12 * 6 * 2);
});

test("in checklist mode a stored approval is shown routed, with the checklist reason", async () => {
  const b = bundle("case_01");
  const d = await reviewCase(b, { apiKey: "k", fetchImpl: fetchFor(reportFrom(finalLabels("case_01"))), sleep: async () => {} });
  assert.equal(d.routing, "approve");
  const r = redecide(b, d, false);
  assert.equal(r.routing, "route");
  assert.match(r.routing_reasons[0], /Checklist mode is on/);
  assert.equal(r.named_gap, null);
});

test("a stored decision that failed is shown routed, with its error; no stored decision is null", () => {
  const r = redecide(bundle("case_02"), { error: "API returned HTTP 529: overloaded", criteria: null }, true);
  assert.equal(r.routing, "route");
  assert.match(r.routing_reasons[0], /HTTP 529/);
  assert.equal(redecide(bundle("case_02"), null, true), null);
  assert.equal(redecide(bundle("case_02"), undefined, true), null);
});

// ---- The build's refusals ----------------------------------------------------------------------------------------
function buildWith(runDir) {
  const out = join(mkdtempSync(join(tmpdir(), "demo-build-")), "content.js");
  const r = spawnSync("python3", ["demo/build_demo.py", "--out", out, "--stored-run", runDir], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, text: (r.stdout || "") + (r.stderr || ""), out };
}
function fixtureRun(name, { run = {}, decisions = {} } = {}) {
  const dir = join("eval/runs", name);
  mkdirSync(join(ROOT, dir), { recursive: true });
  writeFileSync(join(ROOT, dir, "run.json"), JSON.stringify({ agent_version: AGENT_VERSION, spec_sha256: SPEC_SHA256,
    started_utc: "2026-11-08T00:00:00Z", finished_utc: "2026-11-08T00:10:00Z", case_set: "all12", budget: "release",
    cases: Object.fromEntries(Object.keys(decisions).map(k => [k, {}])), ...run }));
  for (const [id, d] of Object.entries(decisions)) writeFileSync(join(ROOT, dir, id + ".json"), JSON.stringify(d));
  return dir;
}
const okDecision = { routing: "route", criteria: null, error: "x" };

test("the build takes a finished run of this agent, and refuses an unfinished run, another agent, or an unlabeled case", () => {
  const tag = "demo-test-" + process.pid;
  const dirs = [];
  try {
    let dir = fixtureRun(tag + "-ok", { decisions: { case_01: okDecision, case_00: okDecision } }); dirs.push(dir);
    let r = buildWith(dir);
    assert.equal(r.code, 0, r.text);
    const content = readFileSync(r.out, "utf8");
    assert.match(content, /"stored":\{"case_01":/, "the golden case's decision is kept");
    assert.doesNotMatch(content, /"case_00":\{"case_id"/, "the smoke case is left out");

    dir = fixtureRun(tag + "-unfinished", { run: { finished_utc: undefined }, decisions: { case_01: okDecision } }); dirs.push(dir);
    r = buildWith(dir); assert.notEqual(r.code, 0); assert.match(r.text, /did not finish/);

    dir = fixtureRun(tag + "-old", { run: { agent_version: "agent-0.0" }, decisions: { case_01: okDecision } }); dirs.push(dir);
    r = buildWith(dir); assert.notEqual(r.code, 0); assert.match(r.text, /made by agent-0\.0/);

    dir = fixtureRun(tag + "-unlabeled", { decisions: { case_05: okDecision } }); dirs.push(dir);
    r = buildWith(dir);
    // Checked while case 05 still waits for its final labels; once all twelve are settled there is no case to try.
    if (!existsLabels("case_05")) { assert.notEqual(r.code, 0); assert.match(r.text, /no final labels yet/); }

    r = buildWith("eval/runs/../../etc"); assert.notEqual(r.code, 0); assert.match(r.text, /not a folder under eval\/runs/);
    r = buildWith("eval/runs/does-not-exist"); assert.notEqual(r.code, 0);
  } finally {
    for (const d of dirs) rmSync(join(ROOT, d), { recursive: true, force: true });
  }
});

function existsLabels(id) { try { readFileSync(join(ROOT, "data/golden", id, "labels.yaml")); return true; } catch { return false; } }

test("the build refuses when the plan and the runner disagree on the held-out cases", () => {
  const plan = join(ROOT, "docs/EVAL_PLAN.md");
  const before = readFileSync(plan, "utf8");
  try {
    writeFileSync(plan, before.replace("Held-out cases, 3 of the 12: cases 08, 10, and 12.", "Held-out cases, 3 of the 12: cases 07, 10, and 12."));
    const r = spawnSync("python3", ["demo/build_demo.py", "--out", join(mkdtempSync(join(tmpdir(), "demo-build-")), "c.js")], { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /held-out cases differ/);
  } finally { writeFileSync(plan, before); }
});
