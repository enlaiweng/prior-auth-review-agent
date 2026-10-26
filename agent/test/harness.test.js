// End-to-end test of a run with a fake model on this computer: eval/run_agent.mjs on the smoke case, then
// eval/score.py on what it wrote. Checks the budget rules too. Nothing is sent to Anthropic.
// Run from the repository root: node --test 'agent/test/*.test.js'   (needs python3 with pyyaml)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The fake model always returns the same report: made-up test values that fit the smoke case.
const crit = (status, evidence, passages, quote) => ({ explanation: "e", evidence, policy_passages: passages, policy_quote: quote, status });
const report = {
  criteria: {
    C1_red_flag: crit("unsupported", [], ["L34220-17"], "\"Red flags\" include:"),
    C2_conservative_4wk: crit("supported", ["Procedure/case00-pt-01", "MedicationRequest/case00-med-01"], ["L34220-36"],
                              "MRI will be covered only if the patient has not responded to a reasonable trial of conservative management"),
    C3_informs_management: crit("undeterminable", [], ["L34220-39"], "When the findings will not affect the treatment choices, the test is not reasonable or necessary."),
    C4_no_duplicate_imaging: crit("supported", [], ["L34220-41"], "A lumbar MRI that is a duplication of other imaging studies (such as a spinal CT scan) may be unreasonable or unnecessary."),
  },
  contradictions: [], missing_document: { criterion: "C3", missing: "the treatment decision the MRI will inform" },
  case_summary: "s", confidence: "moderate",
};

function run(args, env = {}) {
  return spawnSync("node", ["eval/run_agent.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("a run on the smoke case writes a decision, a run record, and a score", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      seen.push({ key: req.headers["x-api-key"], body: JSON.parse(body) });
      res.setHeader("content-type", "application/json"); res.setHeader("request-id", "req_fake");
      res.end(JSON.stringify({ model: "claude-sonnet-5-fake", stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(report) }],
        usage: { input_tokens: 8000, output_tokens: 2000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 } }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const out = join(mkdtempSync(join(tmpdir(), "agent-run-")), "run");
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/messages`;
    const r = await new Promise(resolve => {
      import("node:child_process").then(({ spawn }) => {
        const p = spawn("node", ["eval/run_agent.mjs", "--cases", "smoke", "--budget", "experiments", "--out", out],
                        { env: { ...process.env, ANTHROPIC_API_KEY: "fake-key", AGENT_TEST_API_URL: url } });
        let so = ""; p.stdout.on("data", c => so += c); p.stderr.on("data", c => so += c);
        p.on("close", code => resolve({ code, so }));
      });
    });
    assert.equal(r.code, 0, r.so);
    assert.ok(!r.so.includes("fake-key"), "the key must never be printed");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].key, "fake-key");
    const d = JSON.parse(readFileSync(join(out, "case_00.json"), "utf8"));
    assert.equal(d.routing, "request");
    const runRec = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
    assert.deepEqual(runRec.models_returned, ["claude-sonnet-5-fake"]);
    assert.equal(runRec.cost_usd_estimate_total, 0.046);   // 8000 x $2 + 2000 x $10 + 4000 x $2.50, per million tokens
    const s = spawnSync("python3", ["eval/score.py", out], { encoding: "utf8" });
    assert.equal(s.status, 0, s.stderr);
    const score = JSON.parse(readFileSync(join(out, "score.json"), "utf8"));
    assert.equal(score.metrics.routing_agreement, 1);
    assert.equal(score.metrics.false_approvals, 0);
    assert.equal(score.metrics.evidence_validity, 1);
    assert.equal(score.metrics.citation_faithfulness, 1);
    assert.equal(score.metrics.per_criterion_agreement, 1);
  } finally {
    server.close();
    rmSync(join(out, ".."), { recursive: true, force: true });
  }
});

test("the experiments budget refuses cases outside the smoke case and the development cases", () => {
  for (const cases of ["nine", "all12", "case_08", "case_06"]) {
    const r = run(["--cases", cases, "--budget", "experiments", "--out", join(tmpdir(), "never")], { ANTHROPIC_API_KEY: "x" });
    assert.equal(r.status, 1, cases);
    assert.match(r.stderr, /not allowed/, cases);
  }
});

test("no golden case runs before its final labels are merged on main", () => {
  const r = run(["--cases", "dev", "--budget", "experiments", "--out", join(tmpdir(), "never")], { ANTHROPIC_API_KEY: "x" });
  const onMain = spawnSync("git", ["cat-file", "-e", "origin/main:data/golden/case_01/labels.yaml"]).status === 0;
  if (!onMain) {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /final labels are merged on main/);
  }
});

test("the held-out list matches the eval plan, and a held-out case never runs on the experiments budget", async () => {
  const m = await import("../../eval/run_agent.mjs");
  m.checkHeldOutMatchesPlan();
  assert.deepEqual(m.HELD_OUT, ["case_08", "case_10", "case_12"]);
  for (const id of m.HELD_OUT) assert.throws(() => m.checkBudget(m.resolveCases(id), "experiments", id), /not allowed/);
});

test("the release budget refuses held-out cases outside all12", () => {
  const r = run(["--cases", "case_10", "--budget", "release", "--out", join(tmpdir(), "never")], { ANTHROPIC_API_KEY: "x" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /held-out/);
});

test("a fake-model address that is not local is ignored, however it is written", async () => {
  const { localTestUrl } = await import("../../eval/run_agent.mjs");
  assert.equal(localTestUrl("http://127.0.0.1:8787/v1/messages"), "http://127.0.0.1:8787/v1/messages");
  for (const bad of ["http://127.0.0.1:@evil.example/", "http://127.0.0.1@evil.example/", "http://user:pw@127.0.0.1:8787/",
                     "https://127.0.0.1:8787/", "http://127.0.0.1.evil.example/", "http://localhost:8787/", "http://10.0.0.1/",
                     "https://api.example.com/", "", null, undefined, 42, "not a url"])
    assert.equal(localTestUrl(bad), null, String(bad));
});
