// Positive and negative tests of every way into the demo, against the real Worker in Cloudflare's local runtime and a
// fake model. These add to api.test.mjs: every case, every outcome, every input shape, every setting, and time passing.
//   Positive: what the demo must do for a visitor using it as intended.
//   Negative: what it must refuse, or survive, when a request or the model's answer is wrong, odd, or hostile.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build, startFakeModel, startDemo, live, sql, PASSCODE, FAKE_KEY, ROOT, finalLabels, reportFrom } from "./local-demo.mjs";

const ALL = Array.from({ length: 12 }, (_, i) => "case_" + String(i + 1).padStart(2, "0"));
const LIVE = ["case_01", "case_02", "case_03"];
let fake;
before(async () => { build(); fake = await startFakeModel(); });
after(() => fake.stop());

const get = async (base, path, init) => { const r = await fetch(base + path, init); return { status: r.status, headers: r.headers, text: await r.text() }; };
const getJson = async (base, path) => { const r = await get(base, path); return { ...r, json: JSON.parse(r.text) }; };
const as = ip => ({ "X-Demo": "1", "CF-Connecting-IP": ip });
let ipCount = 0;
const freshVisitor = () => as("198.51.100." + (++ipCount));   // a visitor no other check has used
const post = (base, id, { body, headers = freshVisitor(), type = "application/json" } = {}) =>
  fetch(base + "/api/run/" + id, { method: "POST", headers: { ...(type ? { "Content-Type": type } : {}), ...headers }, body });
const expectedRouting = id => readFileSync(join(ROOT, "data/golden", id, "labels.yaml"), "utf8").match(/^expected_routing: (\w+)/m)[1];
const namedGap = id => {
  const m = readFileSync(join(ROOT, "data/golden", id, "labels.yaml"), "utf8").match(/^named_gap: \{criterion: (C\d), missing: "([^"]+)"\}/m);
  return m ? { criterion: m[1], missing: m[2] } : null;
};
// The report a careful model would write for this case: its final labels, and the named gap if it has one.
const goodReport = id => reportFrom(finalLabels(id), { missing: namedGap(id) });

async function withDemo(vars, fn) {
  const d = await startDemo({ AGENT_TEST_API_URL: fake.url, LIVE_PER_MINUTE: "50", LIVE_PER_DAY: "500", ...vars });
  try { await fn(d.base, d); } finally { d.stop(); }
}

// ---- Positive ------------------------------------------------------------------------------------------------------

test("positive: every case opens, with its own complete record, and nothing private is ever in an answer", async () => {
  await withDemo({}, async base => {
    const page = await get(base, "/");
    assert.equal((await get(base, "/index.html")).text, page.text, "/index.html is the same page");
    assert.equal((await get(base, "/?from=linkedin")).status, 200, "a link with a query still opens the page");
    assert.equal((await get(base, "/api/status?x=1")).status, 200);
    const bodies = [page.text, (await get(base, "/api/status")).text, (await get(base, "/api/cases")).text];
    for (const id of ALL) {
      const r = await getJson(base, "/api/cases/" + id);
      assert.equal(r.status, 200, id);
      const c = r.json;
      const n = id.slice(5);
      assert.equal(c.case, id);
      assert.equal(c.name, "Case " + n);
      assert.equal(c.view.request.id, `Claim/case${n}-claim`, id + ": the request is this case's own");
      const ids = [c.view.request.id, c.view.patient.id, ...c.view.sections.flatMap(s => s.items.map(i => i.id)), c.view.note.id, ...c.view.note.paragraphs.map(p => p.id)];
      assert.equal(new Set(ids).size, ids.length, id + ": every record id is unique");
      assert.ok(c.view.note.paragraphs.length > 0 && c.view.sections.length > 0, id + ": the record has entries and a note");
      for (const other of ALL.filter(x => x !== id)) assert.ok(!r.text.includes("case" + other.slice(5) + "-"), id + " shows nothing from " + other);
      bodies.push(r.text);
    }
    for (const b of bodies) {
      for (const secret of [FAKE_KEY, PASSCODE, "expected_routing", "labels.yaml", "intended", "named_gap\":{\"criterion"])
        assert.ok(!b.includes(secret), "an answer contains " + secret);
    }
  });
});

test("positive: with approvals on, each live case gets its own right outcome (approve, route, request one document)", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async base => {
    const seen = {};
    for (const id of LIVE) {
      fake.calls.length = 0;
      fake.reply = () => ({ report: goodReport(id) });
      const r = await live(base, id, PASSCODE, freshVisitor());
      assert.equal(r.status, 200, id);
      const d = r.lines.at(-1).decision;
      seen[id] = d.routing;
      assert.equal(d.routing, expectedRouting(id), id + ": the outcome the final labels call for");
      assert.equal(d.checklist_mode, false);
      if (d.routing === "request") assert.deepEqual(d.named_gap.criterion, namedGap(id).criterion, id + ": names the one missing document");
      else assert.equal(d.named_gap, null);
      // The model was sent this case's record, and nothing that holds the answer.
      const sent = JSON.stringify(fake.calls[0].body);
      assert.match(sent, new RegExp(`case${id.slice(5)}-claim`));
      for (const other of ALL.filter(x => x !== id)) assert.ok(!sent.includes(`case${other.slice(5)}-claim`), id + ": no other case's record");
      assert.ok(!/expected_routing|intended answer/i.test(sent), id + ": no labels or intended answers");
    }
    assert.deepEqual(Object.values(seen).sort(), ["approve", "request", "route"], "all three outcomes are exercised");
  });
});

test("positive: in checklist mode, the same reports all route, with the criteria still shown and no document asked for", async () => {
  await withDemo({}, async base => {
    for (const id of LIVE) {
      fake.reply = () => ({ report: goodReport(id) });
      const d = (await live(base, id, PASSCODE, freshVisitor())).lines.at(-1).decision;
      assert.equal(d.routing, "route", id);
      assert.equal(d.named_gap, null, id);
      assert.match(d.routing_reasons[0], /Checklist mode is on/);
      assert.equal(Object.keys(d.criteria).length, 4, id + ": all four criteria shown");
    }
  });
});

test("positive: a busy model (HTTP 529) is retried, and the run still finishes", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async base => {
    fake.calls.length = 0;
    fake.reply = () => fake.calls.length === 1
      ? { status: 529, body: { error: { message: "overloaded" } }, headers: { "retry-after": "1" } }
      : { report: goodReport("case_01") };
    const d = (await live(base, "case_01", PASSCODE, freshVisitor())).lines.at(-1).decision;
    assert.equal(fake.calls.length, 2, "one retry");
    assert.equal(d.routing, "approve");
    assert.equal(d.error, null);
  });
});

test("positive: settings are read safely (bad numbers fall back; a 12-character passcode works; spaces around it are ignored)", async () => {
  for (const [minute, day] of [["abc", "1.5"], ["0", "-3"], ["", " "]]) {
    await withDemo({ LIVE_PER_MINUTE: minute, LIVE_PER_DAY: day }, async base => {
      const s = (await getJson(base, "/api/status")).json.live;
      assert.deepEqual([s.per_minute, s.per_day], [2, 20], `LIVE_PER_MINUTE ${JSON.stringify(minute)}, LIVE_PER_DAY ${JSON.stringify(day)}`);
    });
  }
  fake.reply = () => ({ report: goodReport("case_01") });
  await withDemo({ DEMO_PASSCODE: "exactly-12ch" }, async base => {
    assert.equal((await getJson(base, "/api/status")).json.live.problem, null, "12 characters is enough");
    assert.equal((await live(base, "case_01", "exactly-12ch", freshVisitor())).status, 200);
  });
  await withDemo({ DEMO_PASSCODE: "only-11-chr" }, async base => {
    assert.match((await getJson(base, "/api/status")).json.live.problem, /no passcode/, "11 characters is not");
  });
  await withDemo({ DEMO_PASSCODE: "  " + PASSCODE + "  " }, async base => {
    assert.equal((await live(base, "case_01", PASSCODE, freshVisitor())).status, 200, "a passcode saved with spaces around it still works");
  });
});

test("positive: time passing: the wrong-passcode pause lifts after ten minutes, the day's cap resets, old rows are deleted", async () => {
  fake.reply = () => ({ report: goodReport("case_01") });
  await withDemo({ LIVE_PER_DAY: "2" }, async (base, d) => {
    const v = as("203.0.113.77");
    for (let i = 0; i < 5; i++) await live(base, "case_01", "wrong-" + i, v);
    assert.equal((await live(base, "case_01", PASSCODE, v)).status, 429, "paused");
    sql(d, "UPDATE live_runs SET at_ms = at_ms - 601000 WHERE outcome = 'bad_passcode'");
    assert.equal((await live(base, "case_01", PASSCODE, v)).status, 200, "ten minutes later, the right passcode works again");

    // The everyone-pause lifts the same way.
    for (let n = 0; n < 10; n++) for (let i = 0; i < 5; i++) await live(base, "case_01", "w" + i, as("10.9.0." + n));
    assert.equal((await live(base, "case_01", PASSCODE, freshVisitor())).status, 429, "everyone paused");
    sql(d, "UPDATE live_runs SET at_ms = at_ms - 601000 WHERE outcome = 'bad_passcode'");

    assert.equal((await live(base, "case_01", PASSCODE, freshVisitor())).status, 200, "the second run of the day");
    let r = await live(base, "case_01", PASSCODE, freshVisitor());
    assert.equal(r.status, 429); assert.equal(r.json.code, "per_day");
    sql(d, "UPDATE live_runs SET at_ms = at_ms - 86400000");
    assert.equal((await getJson(base, "/api/status")).json.live.used_today, 0, "a new day");
    assert.equal((await live(base, "case_01", PASSCODE, freshVisitor())).status, 200, "the next day's first run");

    sql(d, "INSERT INTO live_runs (at_ms, case_id, outcome) VALUES (" + (Date.now() - 4 * 86400000) + ", 'case_01', 'done')");
    const oldBefore = sql(d, "SELECT COUNT(*) AS n FROM live_runs WHERE at_ms < " + (Date.now() - 3 * 86400000))[0].n;
    assert.ok(oldBefore >= 1);
    await live(base, "case_01", "wrong-cleanup", freshVisitor());   // any live-run attempt tidies up
    assert.equal(sql(d, "SELECT COUNT(*) AS n FROM live_runs WHERE at_ms < " + (Date.now() - 3 * 86400000))[0].n, 0, "rows older than three days are gone");
    assert.equal(sql(d, "SELECT COUNT(*) AS n FROM live_runs WHERE who IS NOT NULL AND outcome != 'bad_passcode'")[0].n, 0, "no visitor fingerprint outside wrong-passcode rows");
  });
});

test("positive: a visitor who closes the page mid-run doesn't break anything; the run is still recorded", async () => {
  await withDemo({}, async (base, d) => {
    fake.reply = () => ({ delayMs: 3000, report: goodReport("case_02") });
    const ac = new AbortController();
    const r = await fetch(base + "/api/run/case_02", { method: "POST", headers: { "Content-Type": "application/json", ...freshVisitor() },
      body: JSON.stringify({ passcode: PASSCODE }), signal: ac.signal });
    assert.equal(r.status, 200);
    ac.abort();
    await new Promise(x => setTimeout(x, 6000));
    const rows = sql(d, "SELECT outcome FROM live_runs WHERE outcome != 'bad_passcode'");
    assert.deepEqual(rows.map(x => x.outcome), ["done"], "the run finished and was recorded, not left as started");
    fake.reply = () => ({ report: goodReport("case_01") });
    assert.equal((await live(base, "case_01", PASSCODE, freshVisitor())).status, 200, "the next visitor's run works");
  });
});

// ---- Negative ------------------------------------------------------------------------------------------------------

test("negative: odd addresses and methods get a clear refusal, never a crash", async () => {
  await withDemo({}, async base => {
    const paths = ["/api/status/", "/api/cases/", "/api/cases/CASE_01", "/api/cases/case_013", "/api/cases/case_00", "/api/cases/case_13",
      "/api/cases/case_01/extra", "/api/cases/case_01%00", "/api/cases/%63ase_01x", "/api//cases", "/api", "/api/", "/API/status",
      "/index.htm", "/favicon.ico", "/robots.txt", "/.env", "/wrangler.toml", "/src/worker.js", "/" + "a".repeat(5000),
      "/api/cases/case_01?x=<script>", "/api/run/case_01/"];
    for (const p of paths) {
      const r = await get(base, p);
      assert.ok([404, 405, 414].includes(r.status) || (r.status === 200 && p.startsWith("/api/cases/case_01?")), `${p}: ${r.status}`);
      assert.ok(!r.text.includes(FAKE_KEY));
    }
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const p of ["/api/status", "/api/cases", "/api/cases/case_01", "/api/run/case_01"]) {
        const r = await fetch(base + p, { method });
        assert.equal(r.status, 405, `${method} ${p}`);
      }
    }
    const head = await fetch(base + "/api/run/case_01", { method: "HEAD" });
    assert.ok(head.status >= 400, "HEAD never starts a run");
    assert.equal((await get(base, "/api/run/case_01")).status, 405, "GET never starts a run");
  });
});

test("negative: badly formed live-run requests are refused before any passcode check, model call, or count", async () => {
  await withDemo({}, async (base, d) => {
    fake.calls.length = 0;
    const good = JSON.stringify({ passcode: PASSCODE });
    // (A value of "1 " is not tried: HTTP strips spaces from the ends of header values, so it arrives as "1".)
    for (const v of ["0", "true", "01", "", "yes", "1,1", "l"]) {
      const r = await post(base, "case_01", { body: good, headers: { "X-Demo": v, "CF-Connecting-IP": "192.0.2.10" } });
      assert.equal(r.status, 403, `X-Demo ${JSON.stringify(v)}`);
    }
    for (const type of ["text/plain", "text/json", "application/x-www-form-urlencoded", "multipart/form-data", null]) {
      const r = await post(base, "case_01", { body: good, type, headers: as("192.0.2.10") });
      assert.equal(r.status, 415, `Content-Type ${type}`);
    }
    const bodies = ["", " ", "{", "null", "true", "123", '"passcode"', "[]", "[" + good + "]", '{"passcode":null}', '{"passcode":["' + PASSCODE + '"]}',
      '{"passcode":{"value":"' + PASSCODE + '"}}', '{"passcode":' + PASSCODE.length + "}", '{"Passcode":"' + PASSCODE + '"}',
      JSON.stringify({ passcode: "x".repeat(201) }), "[".repeat(5000) + "]".repeat(5000), JSON.stringify({ passcode: "y", pad: "z".repeat(1000000) }).replace('"y"', '"' + "y".repeat(300) + '"')];
    for (const body of bodies) {
      const r = await post(base, "case_01", { body, headers: as("192.0.2.10") });
      assert.equal(r.status, 400, "body " + JSON.stringify(body.slice(0, 40)));
    }
    assert.equal(fake.calls.length, 0, "nothing reached the model");
    assert.equal(sql(d, "SELECT COUNT(*) AS n FROM live_runs")[0].n, 0, "nothing was counted, not even as a wrong passcode");
    // So the same visitor still has all five wrong-passcode tries left.
    for (let i = 0; i < 5; i++) assert.equal((await live(base, "case_01", "nope-" + i, as("192.0.2.10"))).status, 403, "try " + (i + 1));
  });
});

test("negative: refused cases and wrong passcodes never reach the model; refusals cost no passcode tries", async () => {
  await withDemo({}, async base => {
    fake.calls.length = 0;
    const v = as("192.0.2.20");
    for (const id of ALL.filter(x => !LIVE.includes(x))) for (let i = 0; i < 3; i++) {
      const r = await live(base, id, "wrong-" + i, v);
      assert.equal(r.status, 409, id); assert.equal(r.json.code, "not_live");
    }
    for (const p of ["", " ", PASSCODE.toUpperCase(), PASSCODE.slice(0, -1), PASSCODE + "x", " " + PASSCODE, PASSCODE.normalize("NFD") + "́"]) {
      const r = await live(base, "case_01", p, freshVisitor());
      assert.equal(r.status, 403, "passcode " + JSON.stringify(p)); assert.equal(r.json.code, "bad_passcode");
    }
    assert.equal(fake.calls.length, 0);
    for (let i = 0; i < 5; i++) assert.equal((await live(base, "case_01", "nope-" + i, v)).status, 403, "27 refusals cost none of the five tries");
    // Request header names are not case-sensitive, so a correctly made request in another letter case still works.
    fake.reply = () => ({ report: goodReport("case_01") });
    const r = await fetch(base + "/api/run/case_01", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json; charset=utf-8", "CF-Connecting-IP": "192.0.2.21" }, body: JSON.stringify({ passcode: PASSCODE, extra: "ignored" }) });
    assert.equal(r.status, 200, "a charset on the content type, and extra fields, are fine");
    await r.text();
  });
});

test("negative: whatever the model sends back, the fixed rule stays in charge and never approves on bad evidence", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async base => {
    const run = async (reply, id = "case_01") => { fake.reply = reply; return (await live(base, id, PASSCODE, freshVisitor())).lines.at(-1).decision; };
    const bad = mutate => () => { const r = goodReport("case_01"); mutate(r); return { report: r }; };

    let d = await run(bad(r => { r.criteria.C2_conservative_4wk.evidence = ["Procedure/case01-pt-99"]; }));
    assert.equal(d.routing, "route", "made-up evidence id"); assert.match(d.routing_reasons.join(" "), /not found in this case/);

    d = await run(bad(r => { r.criteria.C2_conservative_4wk.evidence = ["Procedure/case02-pt-01"]; }));
    assert.equal(d.routing, "route", "evidence from another case");

    d = await run(bad(r => { r.criteria.C3_informs_management.policy_passages = ["L99999-1"]; }));
    assert.notEqual(d.routing, "approve", "a made-up policy passage");

    d = await run(bad(r => { r.criteria.C1_red_flag.status = "denied"; }));
    assert.equal(d.routing, "route", "a status outside the schema (there is no deny)"); assert.ok(d.error);

    d = await run(bad(r => { delete r.criteria.C4_no_duplicate_imaging; }));
    assert.equal(d.routing, "route", "a criterion missing"); assert.ok(d.error);

    d = await run(bad(r => { r.routing = "approve"; r.decision = "approve"; }));
    assert.ok(d.routing === "approve" ? d.basis === "C2" && !d.error : true, "a model can't choose the outcome by adding a field");

    for (const [what, text] of [["plain words", "I deny this request."], ["nothing", ""], ["half a report", JSON.stringify(goodReport("case_01")).slice(0, 80)],
                                 ["a list", "[]"], ["a report in a code fence", "```json\n" + JSON.stringify(goodReport("case_02")) + "\n```"]]) {
      d = await run(() => ({ text }));
      assert.notEqual(d.routing, "approve", what);
      if (what !== "a report in a code fence") assert.ok(d.error, what + ": the error is shown");
    }

    for (const [status, body] of [[401, { error: { message: "invalid x-api-key" } }], [400, { error: { message: "bad" } }], [500, { nope: 1 }]]) {
      d = await run(() => ({ status, body, headers: { "retry-after": "1" } }));
      assert.equal(d.routing, "route", "HTTP " + status); assert.match(d.error, new RegExp("HTTP " + status));
    }
    // In every answer, the key never appears.
    assert.ok(!JSON.stringify(d).includes(FAKE_KEY));
  });
});
