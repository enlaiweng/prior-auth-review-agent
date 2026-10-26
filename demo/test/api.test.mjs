// The demo's web interface, against the real Worker in Cloudflare's local runtime and a fake model.
// Each refusal is checked for its status, its reason, and that it reached no model and changed no count.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build, startFakeModel, startDemo, live, PASSCODE, FAKE_KEY, finalLabels, reportFrom } from "./local-demo.mjs";

// Live now: the development cases (01 to 05) that are settled and not being read by the outside clinician (demo/live_scope.json).
const LIVE = ["case_01", "case_02", "case_03"];
let fake;
before(async () => { build(); fake = await startFakeModel(); });
after(() => fake.stop());

const get = async (base, path) => { const r = await fetch(base + path); return { status: r.status, headers: r.headers, text: await r.text() }; };
const getJson = async (base, path) => { const r = await get(base, path); return { ...r, json: JSON.parse(r.text) }; };
async function withDemo(vars, fn) {
  const d = await startDemo({ AGENT_TEST_API_URL: fake.url, ...vars });
  try { await fn(d.base); } finally { d.stop(); }
}
const used = async base => (await getJson(base, "/api/status")).json.live.used_today;

test("the page and the read-only interface, in the default (checklist) mode", async () => {
  await withDemo({}, async base => {
    const page = await get(base, "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.text, /It never denies\./);

    const s = (await getJson(base, "/api/status")).json;
    assert.equal(s.mode, "checklist");
    assert.equal(s.live.problem, null);
    assert.equal(s.live.per_minute, 2);
    assert.equal(s.live.per_day, 20);
    assert.deepEqual(s.held_out, ["case_08", "case_10", "case_12"]);
    assert.equal(s.stored_run, null);
    assert.match(s.agent.version, /^agent-/);

    const list = (await getJson(base, "/api/cases")).json.cases;
    assert.equal(list.length, 12);
    assert.deepEqual(list.filter(c => c.live_refusal === null).map(c => c.case), LIVE, "exactly the cases the live scope allows");
    const why = id => list.find(c => c.case === id);
    for (const id of ["case_08", "case_10", "case_12"]) { assert.equal(why(id).refusal, "held_out"); assert.match(why(id).live_refusal, /held-out/); }
    for (const id of ["case_05", "case_07"]) { assert.equal(why(id).refusal, "unlabeled"); assert.match(why(id).live_refusal, /isn't settled yet/); }
    assert.equal(why("case_04").refusal, "outside_reader"); assert.match(why("case_04").live_refusal, /outside clinician is reading/);
    for (const id of ["case_06", "case_09", "case_11"]) { assert.equal(why(id).refusal, "before_run1"); assert.match(why(id).live_refusal, /run 1/); }
    assert.equal(s.live_scope, "dev");
    assert.ok(list.every(c => c.stored === null), "no stored run yet");

    const one = (await getJson(base, "/api/cases/case_04")).json;
    assert.equal(one.view.request.id, "Claim/case04-claim");
    assert.ok(one.view.note.paragraphs.length > 0);
    assert.equal(one.decision, null);

    for (const [path, status] of [["/api/cases/case_99", 404], ["/api/cases/case_1", 404], ["/api/nothing", 404], ["/nothing", 404], ["/api/cases/%2e%2e", 404]])
      assert.equal((await get(base, path)).status, status, path);
    for (const [method, path] of [["POST", "/api/cases"], ["DELETE", "/api/cases/case_01"], ["GET", "/api/run/case_01"], ["PUT", "/api/status"], ["OPTIONS", "/api/run/case_01"]]) {
      const r = await fetch(base + path, { method });
      assert.equal(r.status, 405, `${method} ${path}`);
    }
  });
});

test("live runs: every refusal, then a real one routed in checklist mode, with the key never shown", async () => {
  await withDemo({}, async base => {
    fake.calls.length = 0;
    fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
    const before = await used(base);

    let r = await live(base, "case_01", PASSCODE, {});
    assert.equal(r.status, 403); assert.equal(r.json.code, "bad_request");
    const raw = await fetch(base + "/api/run/case_01", { method: "POST", headers: { "X-Demo": "1", "Content-Type": "text/plain" }, body: "x" });
    assert.equal(raw.status, 415);
    const badJson = await fetch(base + "/api/run/case_01", { method: "POST", headers: { "X-Demo": "1", "Content-Type": "application/json" }, body: "{not json" });
    assert.equal(badJson.status, 400);
    for (const body of [JSON.stringify({}), JSON.stringify({ passcode: 12345 }), JSON.stringify({ passcode: "x".repeat(201) }), "null", "[]"]) {
      const x = await fetch(base + "/api/run/case_01", { method: "POST", headers: { "X-Demo": "1", "Content-Type": "application/json" }, body });
      assert.equal(x.status, 400, body.slice(0, 30));
    }
    r = await live(base, "case_99"); assert.equal(r.status, 404);
    for (const id of ["case_08", "case_10", "case_12"]) { r = await live(base, id); assert.equal(r.status, 409, id); assert.equal(r.json.code, "not_live"); assert.match(r.json.error, /held-out/); }
    for (const id of ["case_05", "case_07"]) { r = await live(base, id); assert.equal(r.status, 409, id); assert.match(r.json.error, /isn't settled yet/); }
    r = await live(base, "case_04"); assert.equal(r.status, 409); assert.match(r.json.error, /outside clinician/);
    for (const id of ["case_06", "case_09", "case_11"]) { r = await live(base, id); assert.equal(r.status, 409, id); assert.match(r.json.error, /run 1/); }
    r = await live(base, "case_01", "wrong-passcode-123"); assert.equal(r.status, 403); assert.equal(r.json.code, "bad_passcode");
    r = await live(base, "case_01", PASSCODE + " "); assert.equal(r.status, 403, "no trimming: the passcode must match exactly");
    assert.equal(fake.calls.length, 0, "no refusal reached the model");
    assert.equal(await used(base), before, "no refusal counted as a run");

    r = await live(base, "case_01");
    assert.equal(r.status, 200);
    assert.deepEqual(r.lines.map(l => l.type), ["started", "decision"]);
    assert.equal(r.lines[0].mode, "checklist");
    const d = r.lines[1].decision;
    assert.equal(d.routing, "route");
    assert.equal(d.checklist_mode, true);
    assert.match(d.routing_reasons[0], /Checklist mode is on/);
    assert.equal(d.criteria.C2_conservative_4wk.status, "supported");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].key, FAKE_KEY, "the demo's key is the one sent to the model");
    assert.match(JSON.stringify(fake.calls[0].body), /case01-claim/, "the case's own record was sent");
    assert.ok(!r.text.includes(FAKE_KEY), "the key never appears in a response");
    assert.equal(await used(base), before + 1);
    for (const path of ["/", "/api/status", "/api/cases", "/api/cases/case_01"]) assert.ok(!(await get(base, path)).text.includes(FAKE_KEY), path);
  });
});

test("approvals only when CHECKLIST_MODE is exactly \"false\"", async () => {
  fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
  await withDemo({ CHECKLIST_MODE: "false" }, async base => {
    assert.equal((await getJson(base, "/api/status")).json.mode, "approve");
    const r = await live(base, "case_01");
    assert.equal(r.lines[0].mode, "approve");
    assert.equal(r.lines[1].decision.routing, "approve");
    assert.equal(r.lines[1].decision.basis, "C2");
  });
  for (const value of ["true", "FALSE", "False", "no", "0", "off", "false.", "\"false\""]) {
    await withDemo({ CHECKLIST_MODE: value }, async base => {
      assert.equal((await getJson(base, "/api/status")).json.mode, "checklist", JSON.stringify(value));
      const r = await live(base, "case_01");
      assert.equal(r.lines[1].decision.routing, "route", JSON.stringify(value));
    });
  }
});

test("a failed or slow model call routes the case, with the error shown", async () => {
  await withDemo({ LIVE_DEADLINE_SECONDS: "3", LIVE_PER_MINUTE: "10" }, async base => {
    fake.reply = () => ({ status: 400, body: { error: { message: "fake bad request" } } });
    let r = await live(base, "case_02");
    let d = r.lines.at(-1).decision;
    assert.equal(d.routing, "route"); assert.match(d.error, /HTTP 400: fake bad request/);

    fake.reply = () => ({ report: { not: "the schema" } });
    r = await live(base, "case_02");
    d = r.lines.at(-1).decision;
    assert.equal(d.routing, "route"); assert.match(d.error, /does not match the schema/);

    fake.reply = () => ({ hang: true });
    const t = Date.now();
    r = await live(base, "case_02");
    d = r.lines.at(-1).decision;
    assert.equal(d.routing, "route");
    assert.match(d.error, /time limit/);
    assert.ok(Date.now() - t < 30000, "gave up near the deadline instead of retrying for minutes");
  });
});

test("a slow model call streams a progress line every ten seconds", async () => {
  await withDemo({}, async base => {
    fake.reply = () => ({ delayMs: 11000, report: reportFrom(finalLabels("case_03")) });
    const r = await live(base, "case_03");
    const types = r.lines.map(l => l.type);
    assert.equal(types[0], "started");
    assert.ok(types.includes("waiting"), types.join(","));
    assert.equal(types.at(-1), "decision");
  });
});

test("the per-minute and per-day caps, including requests sent at the same moment", async () => {
  fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
  await withDemo({ LIVE_PER_MINUTE: "1", LIVE_PER_DAY: "5" }, async base => {
    const all = await Promise.all([1, 2, 3, 4].map(() => live(base, "case_01")));
    assert.equal(all.filter(r => r.status === 200).length, 1, "exactly one of four simultaneous runs goes through");
    for (const r of all.filter(r => r.status !== 200)) { assert.equal(r.status, 429); assert.equal(r.json.code, "per_minute"); }
    assert.equal(await used(base), 1);
  });
  await withDemo({ LIVE_PER_MINUTE: "10", LIVE_PER_DAY: "2" }, async base => {
    assert.equal((await live(base, "case_01")).status, 200);
    assert.equal((await live(base, "case_02")).status, 200);
    const r = await live(base, "case_03");
    assert.equal(r.status, 429); assert.equal(r.json.code, "per_day"); assert.match(r.json.error, /used up/);
  });
});

const as = ip => ({ "X-Demo": "1", "CF-Connecting-IP": ip });
test("wrong passcodes pause that visitor after five, even sent all at once, and everyone after fifty", async () => {
  await withDemo({}, async base => {
    fake.calls.length = 0;
    for (let i = 0; i < 5; i++) assert.equal((await live(base, "case_01", "wrong-" + i, as("203.0.113.1"))).status, 403);
    let r = await live(base, "case_01", "wrong-again", as("203.0.113.1"));
    assert.equal(r.status, 429); assert.equal(r.json.code, "locked");
    r = await live(base, "case_01", PASSCODE, as("203.0.113.1"));
    assert.equal(r.status, 429, "the right passcode waits too, so the pause can't be used to test guesses");
    assert.equal((await live(base, "case_01", "wrong-x", as("198.51.100.2"))).status, 403, "another visitor is not paused");

    // Twenty guesses at the same moment from one new visitor: at most five are checked.
    const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => live(base, "case_02", "burst-" + i, as("192.0.2.3"))));
    assert.equal(burst.filter(x => x.status === 403).length, 5, "exactly five checked");
    assert.equal(burst.filter(x => x.status === 429).length, 15);

    // Fifty wrong passcodes in ten minutes across visitors pause everyone.
    for (let v = 0; v < 10; v++) for (let i = 0; i < 5; i++) await live(base, "case_01", "w" + i, as("10.0.0." + v));
    r = await live(base, "case_01", PASSCODE, as("198.18.0.9"));
    assert.equal(r.status, 429, "after fifty wrong passcodes in all, a fresh visitor waits too");
    assert.equal(fake.calls.length, 0, "no guess reached the model");
    assert.equal((await getJson(base, "/api/cases")).json.cases.length, 12, "the stored side still answers");
  });
});

test("a right passcode leaves no wrong-passcode mark", async () => {
  fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
  await withDemo({ LIVE_PER_MINUTE: "20" }, async base => {
    for (let i = 0; i < 7; i++) assert.equal((await live(base, "case_01", PASSCODE, as("203.0.113.50"))).status, 200, "run " + (i + 1));
    assert.equal((await live(base, "case_01", "wrong", as("203.0.113.50"))).status, 403, "seven right passcodes used none of the five");
  });
});

test("without a key or a proper passcode, live runs say they aren't set up", async () => {
  await withDemo({ ANTHROPIC_API_KEY: null }, async base => {
    assert.match((await getJson(base, "/api/status")).json.live.problem, /no model key/);
    const r = await live(base, "case_01"); assert.equal(r.status, 503); assert.equal(r.json.code, "live_off");
  });
  await withDemo({ DEMO_PASSCODE: "short" }, async base => {
    assert.match((await getJson(base, "/api/status")).json.live.problem, /no passcode/);
    const r = await live(base, "case_01", "short"); assert.equal(r.status, 503);
  });
});

test("stored decisions from a finished run are shown, decided again under the current mode", async () => {
  const { reviewCase, AGENT_VERSION } = await import("../../agent/agent.js");
  const { SPEC_SHA256 } = await import("../../agent/spec.generated.js");
  const { mkdirSync, writeFileSync, rmSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { ROOT } = await import("./local-demo.mjs");
  const dir = `eval/runs/demo-test-stored-${process.pid}`;
  mkdirSync(join(ROOT, dir), { recursive: true });
  try {
    const bundle = id => JSON.parse(readFileSync(join(ROOT, "data/golden", id, "bundle.json"), "utf8"));
    const answer = report => async () => new Response(JSON.stringify({ model: "fake", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(report) }], usage: {} }));
    const d1 = await reviewCase(bundle("case_01"), { apiKey: "k", caseId: "case_01", fetchImpl: answer(reportFrom(finalLabels("case_01"))), sleep: async () => {} });
    const d2 = await reviewCase(bundle("case_02"), { apiKey: "k", caseId: "case_02", fetchImpl: async () => new Response("{}", { status: 400 }), sleep: async () => {} });
    assert.equal(d1.routing, "approve");
    writeFileSync(join(ROOT, dir, "case_01.json"), JSON.stringify(d1));
    writeFileSync(join(ROOT, dir, "case_02.json"), JSON.stringify(d2));
    writeFileSync(join(ROOT, dir, "run.json"), JSON.stringify({ agent_version: AGENT_VERSION, spec_sha256: SPEC_SHA256, case_set: "nine", budget: "release",
      started_utc: "2026-11-01T18:00:00Z", finished_utc: "2026-11-01T18:20:00Z", cases: { case_01: {}, case_02: {} } }));
    build(["--stored-run", dir]);
    for (const [mode, expected] of [[null, "route"], ["false", "approve"]]) {
      await withDemo({ CHECKLIST_MODE: mode }, async base => {
        const s = (await getJson(base, "/api/status")).json;
        assert.equal(s.stored_run.folder, dir);
        const list = (await getJson(base, "/api/cases")).json.cases;
        assert.deepEqual(list.find(c => c.case === "case_01").stored, { routing: expected, error: false });
        assert.deepEqual(list.find(c => c.case === "case_02").stored, { routing: "route", error: true });
        assert.equal(list.find(c => c.case === "case_03").stored, null);
        const one = (await getJson(base, "/api/cases/case_01")).json.decision;
        assert.equal(one.routing, expected);
        assert.equal(one.checklist_mode, mode !== "false");
        if (mode === null) assert.match(one.routing_reasons[0], /Checklist mode is on/);
        const two = (await getJson(base, "/api/cases/case_02")).json.decision;
        assert.match(two.error, /HTTP 400/);
      });
    }
  } finally {
    rmSync(join(ROOT, dir), { recursive: true, force: true });
    build();   // back to the repository's own content
  }
});
