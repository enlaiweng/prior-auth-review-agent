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

// ---- The release evaluation's side checks (eval/README.md, rule 10) ------------------------------------------------

const noteOf = bundle => Buffer.from(bundle.entry.map(e => e.resource).find(r => r.resourceType === "DocumentReference")
  .content[0].attachment.data, "base64").toString("utf8");
const paragraphsOf = bundle => noteOf(bundle).trim().split(/\n\s*\n/).map(p => p.trim());
const golden = id => JSON.parse(readFileSync(`data/golden/${id}/bundle.json`, "utf8"));

test("the no-instruction variant takes out exactly the sentence that addresses the reviewer, and nothing else", async () => {
  const m = await import("../../eval/run_agent.mjs");
  const sentences = m.instructionSentences();
  assert.deepEqual(Object.keys(sentences).sort(), ["case_09", "case_11"]);
  for (const [id, sentence] of Object.entries(sentences)) {
    const before = golden(id), after = m.applyVariant(before, "no-instruction", id);
    assert.match(sentence, /Please approve\.$/, id);
    assert.deepEqual(paragraphsOf(after), paragraphsOf(before).slice(0, -1), id + ": every other paragraph keeps its text and its number");
    assert.equal(paragraphsOf(before).at(-1), sentence, id);
    assert.ok(!noteOf(after).includes("approve"), id);
    // Only the note's text differs between the two bundles.
    const strip = b => JSON.stringify(b).replace(/"data":"[^"]*"/, '"data":""');
    assert.equal(strip(after), strip(before), id);
    assert.equal(noteOf(before), noteOf(golden(id)), id + ": the bundle passed in is not changed");
  }
  assert.throws(() => m.applyVariant(golden("case_01"), "no-instruction", "case_01"), /no instruction sentence is recorded/);
  assert.throws(() => m.applyVariant(golden("case_01"), "shorter", "case_01"), /unknown variant/);
  assert.equal(m.applyVariant(golden("case_01"), null, "case_01") !== null, true);
});

test("the no-notes variant replaces the whole note with one sentence saying none was submitted", async () => {
  const m = await import("../../eval/run_agent.mjs");
  const { readCase } = await import("../record.js");
  for (const id of ["case_01", "case_09", "case_12"]) {
    const after = m.applyVariant(golden(id), "no-notes", id);
    assert.equal(noteOf(after), m.NO_NOTE_TEXT + "\n", id);
    const rc = readCase(after);   // the agent's own input step still reads it: one paragraph, note:p1
    assert.deepEqual(rc.paragraphs, [{ id: "note:p1", text: m.NO_NOTE_TEXT }], id);
  }
});

test("the pairs and the injection cases resolve to their folders, and a pair is held to its original's labels", async () => {
  const m = await import("../../eval/run_agent.mjs");
  assert.deepEqual(m.resolveCases("pairs").map(c => [c.id, c.dir, c.labelsDir, c.heldOut]),
    [["case_01_pair_sex", "data/golden/case_01_pair_sex", "data/golden/case_01", false],
     ["case_09_pair_race", "data/golden/case_09_pair_race", "data/golden/case_09", false]]);
  assert.deepEqual(m.resolveCases("injection").map(c => c.id), ["case_09", "case_11"]);
  assert.equal(m.resolveCases("case_03")[0].labelsDir, "data/golden/case_03");
  // A pair's record is its original's with one attribute changed: the same ids and the same note.
  for (const [pair, original] of Object.entries(m.PAIRS)) {
    assert.equal(noteOf(golden(pair)), noteOf(golden(original)), pair);
    const ids = b => b.entry.map(e => `${e.resource.resourceType}/${e.resource.id}`).sort();
    assert.deepEqual(ids(golden(pair)), ids(golden(original)), pair);
  }
});

test("held-out cases run only after the freeze, and only on the agent the freeze tag holds", async () => {
  const m = await import("../../eval/run_agent.mjs");
  const { SPEC_SHA256 } = await import("../spec.generated.js");
  const spec = sha => () => `export const SPEC_SHA256 = "${sha}";\n`;
  assert.match(m.freezeProblem(() => { throw new Error("no such tag"); }), /the tag v1\.0-freeze does not exist yet/);
  assert.match(m.freezeProblem(spec("a".repeat(64))), /the agent has changed since the freeze/);
  assert.match(m.freezeProblem(() => "nothing useful"), /the agent has changed since the freeze/);
  assert.equal(m.freezeProblem(spec(SPEC_SHA256)), null);
  // The rule is applied whenever a held-out case is in the run, whatever the variant or the model.
  const notFrozen = { frozen: () => "not frozen yet" };
  for (const extra of [{}, { variant: "no-notes" }, { vendorUpdate: true }]) {
    assert.throws(() => m.checkBudget(m.resolveCases("all12"), "release", "all12", { ...notFrozen, ...extra }), /not frozen yet; nothing was run/);
  }
  // The nine never need the freeze: no held-out case is among them.
  assert.equal(m.resolveCases("nine").some(c => c.heldOut), false);
});

test("on the experiments budget a variant or the vendor-update model runs on the smoke case only", () => {
  for (const extra of [["--variant", "no-notes"], ["--model", "vendor-update"]]) {
    const r = run(["--cases", "dev", "--budget", "experiments", "--out", join(tmpdir(), "never"), ...extra], { ANTHROPIC_API_KEY: "x" });
    assert.equal(r.status, 1, extra.join(" "));
    assert.match(r.stderr, /on the smoke case only/, extra.join(" "));
  }
  let r = run(["--cases", "smoke", "--budget", "experiments", "--out", join(tmpdir(), "never"), "--model", "claude-opus-5"], { ANTHROPIC_API_KEY: "x" });
  assert.equal(r.status, 1); assert.match(r.stderr, /unknown model choice/);
  r = run(["--cases", "smoke", "--budget", "experiments", "--out", join(tmpdir(), "never"), "--variant", "shorter"], { ANTHROPIC_API_KEY: "x" });
  assert.equal(r.status, 1); assert.match(r.stderr, /unknown variant/);
});

test("a rehearsal on the smoke case sends the newer model the same request, with the note replaced, and records both", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      seen.push(JSON.parse(body));
      res.setHeader("content-type", "application/json"); res.setHeader("request-id", "req_fake");
      res.end(JSON.stringify({ model: "claude-sonnet-5-5-fake", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(report) }],
        usage: { input_tokens: 8000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const out = join(mkdtempSync(join(tmpdir(), "agent-run-")), "run");
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/messages`;
    const { spawn } = await import("node:child_process");
    const go = extra => new Promise(resolve => {
      const p = spawn("node", ["eval/run_agent.mjs", "--cases", "smoke", "--budget", "experiments", "--out", out, ...extra],
                      { env: { ...process.env, ANTHROPIC_API_KEY: "fake-key", AGENT_TEST_API_URL: url } });
      let so = ""; p.stdout.on("data", c => so += c); p.stderr.on("data", c => so += c);
      p.on("close", code => resolve({ code, so }));
    });
    let r = await go([]);
    assert.equal(r.code, 0, r.so);
    // The run records how many note paragraphs the agent was shown, for the scorer's check of cited paragraph ids.
    const stored = paragraphsOf(JSON.parse(readFileSync("data/smoke/case_00/bundle.json", "utf8"))).length;
    assert.equal(JSON.parse(readFileSync(join(out, "run.json"), "utf8")).cases.case_00.note_paragraphs, stored);
    r = await go(["--variant", "no-notes", "--model", "vendor-update"]);
    assert.equal(r.code, 0, r.so);
    const [plain, changed] = seen;
    assert.equal(plain.model, "claude-sonnet-5");
    assert.equal(changed.model, "claude-sonnet-5-5");
    // Apart from the model and the note, the two requests are the same: the same instructions, schema, and settings.
    const text = b => JSON.stringify(b.messages);
    assert.ok(text(changed).includes("No visit note was submitted with this request."));
    assert.ok(!text(plain).includes("No visit note was submitted with this request."));
    const rest = b => JSON.stringify({ ...b, model: null, messages: null });
    assert.equal(rest(changed), rest(plain));
    const rec = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
    assert.equal(rec.variant, "no-notes"); assert.equal(rec.vendor_update, true);
    assert.equal(rec.cases.case_00.note_paragraphs, 1);
    assert.equal(rec.settings.model, "claude-sonnet-5-5"); assert.equal(rec.settings.effort, "high");
    assert.deepEqual(rec.models_returned, ["claude-sonnet-5-5-fake"]);
  } finally {
    server.close(); rmSync(join(out, ".."), { recursive: true, force: true });
  }
});
