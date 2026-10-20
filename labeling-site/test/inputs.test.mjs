// Positive and negative tests of every input and action on the labeling site, through its HTTP interface, against the
// real Worker code and an empty local database (test/local-site.mjs). Nothing touches Cloudflare.
//
//   positive: something valid is accepted and does what it should.
//   negative: something invalid is refused, with the expected answer and reason, and changes nothing: everything the
//             owner can see (people, their cases and statuses, the download, the activity log) is the same
//             afterwards, and so is the labeler's own copy of the label.
//
// Run from labeling-site/: npm test
// The answers below are made-up test inputs, picked only to exercise the site. They say nothing about any case.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { CONTENT } from "../src/content.generated.js";
import { startSite, ADMIN_KEY } from "./local-site.mjs";

let site, BASE;
// Cleanup waits for setup to finish. When a name filter leaves this file with no test to run, Node's test runner
// starts the cleanup while setup is still going; without the wait, the local site (and browser) would be left
// running and the run would never end.
let ready;
before(() => (ready = (async () => { site = await startSite(); BASE = site.base; })()));
after(async () => { await ready.catch(() => {}); if (site) site.stop(); });

const positive = (name, fn) => test("positive: " + name, fn);
const negative = (name, fn) => test("negative: " + name, fn);

// ---- Talking to the site -----------------------------------------------------------------------------------------

async function send(method, path, { body, raw, cookie, auth, header = true } = {}) {
  const h = {};
  if (header) h["X-Labeling"] = "1";
  if (body !== undefined || raw !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (auth !== undefined) h.Authorization = auth;
  const r = await fetch(BASE + path, { method, headers: h, redirect: "manual",
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text, headers: r.headers };
}
const owner = (method, path, body, opts = {}) => send(method, path, { body, auth: "Bearer " + ADMIN_KEY, ...opts });

// A new labeler invited to `cases`, signed in, and (unless consent is false) past the welcome page.
let count = 0;
async function labeler(cases = ["practice_a"], { consent = true } = {}) {
  const inv = await owner("POST", "/api/admin/labelers", { invited_name: `Test person ${++count}`, cases });
  assert.equal(inv.status, 200, inv.text);
  const token = inv.json.link.split("/l/")[1];
  const s = await send("POST", "/api/session", { body: { token } });
  assert.equal(s.status, 200, s.text);
  const cookie = s.headers.get("set-cookie").split(";")[0];
  const p = { id: inv.json.id, token, cookie, send: (method, path, body, opts = {}) => send(method, path, { body, cookie, ...opts }) };
  if (consent) assert.equal((await p.send("POST", "/api/consent", { credit_name: "T", agree_credit: true, agree_rules: true })).status, 200);
  return p;
}

// Everything the owner can see, to show that a refused request changed nothing.
async function world() {
  const [state, events, exp] = await Promise.all([owner("GET", "/api/admin/state"), owner("GET", "/api/admin/events"), owner("GET", "/api/admin/export")]);
  return { labelers: state.json.labelers, lastEvent: events.json.events[0] ? events.json.events[0].id : 0, exported: exp.json.labels };
}
async function refused(attempt, status, why, { person, caseId } = {}) {
  const before = await world();
  const mine = person && caseId ? (await person.send("GET", "/api/labels/" + caseId)).json : null;
  const r = await attempt();
  assert.equal(r.status, status, `answered ${r.status}: ${r.text.slice(0, 200)}`);
  if (why) assert.match(r.json ? `${r.json.error} ${r.json.code || ""}` : r.text, why);
  assert.deepEqual(await world(), before, "nothing the owner can see changed, and no log entry was written");
  if (mine) assert.deepEqual((await person.send("GET", "/api/labels/" + caseId)).json, mine, "the labeler's label is unchanged");
  return r;
}
async function events(labelerId) { return (await owner("GET", "/api/admin/events")).json.events.filter(e => e.labeler_id === labelerId); }

// Labels.
const idsOf = caseId => { const v = CONTENT.cases[caseId].view; return [v.request.id, v.patient.id, ...v.sections.flatMap(s => s.items.map(i => i.id)), v.note.id, ...v.note.paragraphs.map(p => p.id)]; };
function label(caseId = "practice_a", routing = "approve") {
  const [a, b] = idsOf(caseId);
  return {
    criteria: {
      C1_red_flag: { status: "unsupported", evidence: [] },
      C2_conservative_4wk: { status: "supported", evidence: [a] },
      C3_informs_management: { status: "supported", evidence: [b] },
      C4_no_duplicate_imaging: { status: "supported", evidence: [] },
    },
    routing, gap_criterion: routing === "request" ? "C3" : "", gap_missing: routing === "request" ? "the plan" : "",
  };
}
const blankLabel = () => ({ criteria: Object.fromEntries(["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"].map(k => [k, { status: "", evidence: [] }])), routing: "", gap_criterion: "", gap_missing: "" });
const save = (p, caseId, l, rev = 0, sha = CONTENT.content_sha) => p.send("PUT", "/api/labels/" + caseId, { label: l, rev, content_sha: sha });
const submit = (p, caseId, l, rev = 0, sha = CONTENT.content_sha) => p.send("POST", `/api/labels/${caseId}/submit`, { label: l, rev, content_sha: sha });
const stored = async (p, caseId) => (await p.send("GET", "/api/labels/" + caseId)).json;
const long = n => "x".repeat(n);

// ---- 1. Pages and addresses ---------------------------------------------------------------------------------------

positive("the landing page opens for anyone", async () => {
  const r = await send("GET", "/", { header: false });
  assert.equal(r.status, 200); assert.match(r.text, /Invited labelers only/);
});
positive("the admin page opens without a key, and asks for one", async () => {
  const r = await send("GET", "/admin", { header: false });
  assert.equal(r.status, 200); assert.match(r.text, /Paste the admin key/);
});
positive("a valid personal link shows its Continue page, naming the person, and signs nobody in", async () => {
  const inv = await owner("POST", "/api/admin/labelers", { invited_name: "Link Owner", cases: [] });
  const before = await world();
  const r = await send("GET", "/l/" + inv.json.link.split("/l/")[1], { header: false });
  assert.equal(r.status, 200); assert.match(r.text, /personal link for <b>Link Owner<\/b>/);
  assert.equal(r.headers.get("set-cookie"), null);
  assert.deepEqual(await world(), before);
});
const notValid = /This link isn('|&#39;)t valid any more/;   // the page writes the apostrophe as &#39;
negative("a made-up link", () => refused(() => send("GET", "/l/made-up-token", { header: false }), 404, notValid));
negative("a link longer than any real one", () => refused(() => send("GET", "/l/" + long(101), { header: false }), 404, notValid));
negative("a link with nothing after /l/", () => refused(() => send("GET", "/l/", { header: false }), 404, notValid));
negative("an address that doesn't exist", () => refused(() => send("GET", "/no-such-page", { header: false }), 404, /Page not found/));
negative("sending a form to the landing page", () => refused(() => send("POST", "/", { body: {} }), 404, /Page not found/));
negative("the labeling app without signing in", () => refused(() => send("GET", "/app", { header: false }), 401, /open the personal link/));
negative("the training without signing in", () => refused(() => send("GET", "/training", { header: false }), 401, /open the personal link/));
negative("the app with a made-up sign-in cookie", () => refused(() => send("GET", "/app", { cookie: "__Host-lab_session=made-up", header: false }), 401, /open the personal link/));
positive("the app and the training open once signed in", async () => {
  const p = await labeler();
  assert.equal((await send("GET", "/app", { cookie: p.cookie, header: false })).status, 200);
  assert.equal((await send("GET", "/training", { cookie: p.cookie, header: false })).status, 200);
});

// ---- 2. Signing in with the Continue button (POST /api/session) ---------------------------------------------------

positive("a valid link signs in: a 60-day cookie only this site can read, and one log entry", async () => {
  const inv = await owner("POST", "/api/admin/labelers", { invited_name: "Signer", cases: [] });
  const r = await send("POST", "/api/session", { body: { token: inv.json.link.split("/l/")[1] } });
  assert.equal(r.status, 200);
  const c = r.headers.get("set-cookie");
  for (const part of [/^__Host-lab_session=/, /HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\//, /Max-Age=5184000/]) assert.match(c, part);
  assert.deepEqual((await events(inv.json.id)).map(e => e.action), ["signed in with link", "labeler invited"]);
});
positive("the same link signs in again on a second device", async () => {
  const p = await labeler();
  assert.equal((await send("POST", "/api/session", { body: { token: p.token } })).status, 200);
});
negative("signing in without the site's own header", async () => {
  const p = await labeler();
  await refused(() => send("POST", "/api/session", { body: { token: p.token }, header: false }), 403, /Missing request header/);
});
negative("signing in with a made-up token", () => refused(() => send("POST", "/api/session", { body: { token: "made-up" } }), 404, /isn't valid any more/));
for (const [what, token] of [["a number", 12345], ["a list", ["abc"]], ["an object", { t: 1 }], ["nothing", null], ["empty text", ""]]) {
  negative(`signing in with a token that is ${what}`, () => refused(() => send("POST", "/api/session", { body: { token } }), 404, /isn't valid any more/));
}
negative("signing in with a body that isn't JSON", () => refused(() => send("POST", "/api/session", { raw: "token=abc" }), 404, /isn't valid any more/));
negative("signing in with a turned-off link", async () => {
  const p = await labeler();
  await owner("POST", `/api/admin/labelers/${p.id}/revoke`, {});
  await refused(() => send("POST", "/api/session", { body: { token: p.token } }), 404, /isn't valid any more/);
});
negative("signing in with a link that was replaced", async () => {
  const p = await labeler();
  await owner("POST", `/api/admin/labelers/${p.id}/link`, {});
  await refused(() => send("POST", "/api/session", { body: { token: p.token } }), 404, /isn't valid any more/);
});
negative("using a sign-in cookie after the link was turned off", async () => {
  const p = await labeler();
  await owner("POST", `/api/admin/labelers/${p.id}/revoke`, {});
  await refused(() => p.send("GET", "/api/me"), 401, /open your personal link/);
});

// ---- 3. The welcome page (POST /api/consent) -------------------------------------------------------------------------

const agree = (p, change = {}) => p.send("POST", "/api/consent", { credit_name: "Dr. Example", role: "RN", agree_credit: true, agree_rules: true, ...change });
positive("a name and both boxes: agreed, and the credit is recorded", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  assert.equal((await agree(p)).status, 200);
  const me = (await p.send("GET", "/api/me")).json.labeler;
  assert.equal(me.credit_name, "Dr. Example"); assert.equal(me.role, "RN"); assert.ok(me.consent_at);
  assert.ok((await events(p.id)).some(e => e.action === "consent" && e.detail.credit_name === "Dr. Example"));
});
positive("the role is optional", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  assert.equal((await agree(p, { role: undefined })).status, 200);
  assert.equal((await p.send("GET", "/api/me")).json.labeler.role, "");
});
positive("a name of 100 characters and a role of 150 are accepted", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  assert.equal((await agree(p, { credit_name: long(100), role: long(150) })).status, 200);
});
positive("spaces around the name are trimmed", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  await agree(p, { credit_name: "   Dr. Spaces   " });
  assert.equal((await p.send("GET", "/api/me")).json.labeler.credit_name, "Dr. Spaces");
});
positive("agreeing again later changes the credit name and keeps the first agreement time", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  await agree(p);
  const first = (await p.send("GET", "/api/me")).json.labeler.consent_at;
  await agree(p, { credit_name: "Dr. Renamed" });
  const me = (await p.send("GET", "/api/me")).json.labeler;
  assert.equal(me.credit_name, "Dr. Renamed"); assert.equal(me.consent_at, first);
});
const consentNegatives = [
  ["no name", { credit_name: undefined }, /please enter the name to credit/],
  ["a name of only spaces", { credit_name: "    " }, /please enter the name to credit/],
  ["a name of 101 characters", { credit_name: long(101) }, /longer than 100/],
  ["a role of 151 characters", { role: long(151) }, /longer than 150/],
  ["a name that isn't text", { credit_name: 42 }, /must be text/],
  ["the credit box not ticked", { agree_credit: false }, /both boxes/],
  ["the rules box not ticked", { agree_rules: false }, /both boxes/],
  ["the credit box missing", { agree_credit: undefined }, /both boxes/],
  ["a box sent as the text \"true\"", { agree_credit: "true" }, /both boxes/],
  ["a box sent as 1", { agree_rules: 1 }, /both boxes/],
];
for (const [what, change, why] of consentNegatives) {
  negative(`the welcome page with ${what}`, async () => {
    const p = await labeler(["practice_a"], { consent: false });
    await refused(() => agree(p, change), 400, why);
  });
}
negative("the welcome page with a body that isn't JSON", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  await refused(() => p.send("POST", "/api/consent", undefined, { raw: "credit_name=x" }), 400, /please enter the name/);
});
negative("the welcome page without the site's own header", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  await refused(() => p.send("POST", "/api/consent", { credit_name: "X", agree_credit: true, agree_rules: true }, { header: false }), 403, /Missing request header/);
});

// ---- 4. Before agreeing ---------------------------------------------------------------------------------------------

positive("before agreeing, a labeler can see who they are and their assigned cases", async () => {
  const p = await labeler(["case_02", "practice_a"], { consent: false });
  const me = (await p.send("GET", "/api/me")).json;
  assert.equal(me.labeler.consent_at, null);
  assert.deepEqual(me.assignments.map(a => a.case), ["case_02", "practice_a"]);
});
for (const [what, method, path, body] of [["the case records", "GET", "/api/cases"], ["the training checkbox", "POST", "/api/training", { done: true }],
  ["reading a label", "GET", "/api/labels/practice_a"], ["saving a label", "PUT", "/api/labels/practice_a", { label: {}, rev: 0, content_sha: CONTENT.content_sha }]]) {
  negative(`before agreeing: ${what}`, async () => {
    const p = await labeler(["practice_a"], { consent: false });
    await refused(() => p.send(method, path, body), 403, /complete the welcome page first/);
  });
}

// ---- 5. The training checkbox (POST /api/training) ------------------------------------------------------------------

positive("ticking \"I've done the training\" records the time; unticking clears it", async () => {
  const p = await labeler();
  const on = await p.send("POST", "/api/training", { done: true });
  assert.equal(on.status, 200); assert.ok(on.json.training_done_at);
  assert.ok((await p.send("GET", "/api/me")).json.labeler.training_done_at);
  const off = await p.send("POST", "/api/training", { done: false });
  assert.equal(off.status, 200); assert.equal(off.json.training_done_at, null);
  assert.deepEqual((await events(p.id)).slice(0, 2).map(e => e.action), ["training unmarked", "training marked done"]);
});
for (const [what, done] of [["the text \"yes\"", "yes"], ["the number 1", 1], ["nothing", undefined]]) {
  negative(`the training checkbox sent as ${what}`, async () => {
    const p = await labeler();
    await p.send("POST", "/api/training", { done: true });
    await refused(() => p.send("POST", "/api/training", { done }), 400, /done must be true or false/);
  });
}

// ---- 6. The case records (GET /api/cases) --------------------------------------------------------------------------

positive("a labeler receives exactly their assigned cases, in order, with the content fingerprint and no answer key", async () => {
  const p = await labeler(["practice_b", "case_03"]);
  const r = (await p.send("GET", "/api/cases")).json;
  assert.deepEqual(r.cases.map(c => c.case), ["case_03", "practice_b"]);
  assert.equal(r.content_sha, CONTENT.content_sha);
  assert.ok(r.criteria && r.policy_body && r.legend);
  assert.doesNotMatch(JSON.stringify(r), /intended|expected_routing|worked answer/i);
});
positive("a labeler with no cases receives an empty list", async () => {
  const p = await labeler([]);
  assert.deepEqual((await p.send("GET", "/api/cases")).json.cases, []);
});

// ---- 7. Reading a label (GET /api/labels/<case>) ---------------------------------------------------------------------

positive("an assigned case with nothing saved yet reads as empty, version 0", async () => {
  const p = await labeler();
  assert.deepEqual(await stored(p, "practice_a"), { label: null, rev: 0 });
});
negative("reading a case that isn't assigned", async () => {
  const p = await labeler();
  await refused(() => p.send("GET", "/api/labels/practice_b"), 404, /not assigned to you/);
});
for (const name of ["case_99", "__proto__", "constructor", "tostring", "hasownproperty", "case_01_extra"]) {
  negative(`reading a case named "${name}"`, async () => {
    const p = await labeler();
    await refused(() => p.send("GET", "/api/labels/" + name), 404, /not assigned to you/);
  });
}
for (const name of ["Case_01", "case-01", "case_01;x", long(41)]) {
  negative(`reading a case address with capitals, symbols, or too long ("${name.slice(0, 12)}")`, async () => {
    const p = await labeler();
    await refused(() => p.send("GET", "/api/labels/" + encodeURIComponent(name)), 404, /Not found/);
  });
}

// ---- 8. Saving a label (PUT /api/labels/<case>): positive ------------------------------------------------------------

positive("an empty label (nothing chosen yet) saves as started, version 1, with one log entry", async () => {
  const p = await labeler();
  const r = await save(p, "practice_a", blankLabel());
  assert.equal(r.status, 200); assert.equal(r.json.rev, 1); assert.equal(r.json.complete, false);
  assert.deepEqual((await events(p.id)).filter(e => e.action === "label started").length, 1);
  assert.equal((await p.send("GET", "/api/me")).json.assignments[0].status, "started");
});
positive("every status can be saved: supported, unsupported, undeterminable", async () => {
  const p = await labeler();
  let rev = 0;
  for (const s of ["supported", "unsupported", "undeterminable"]) {
    const l = blankLabel(); l.criteria.C1_red_flag.status = s;
    const r = await save(p, "practice_a", l, rev);
    assert.equal(r.status, 200, s); rev = r.json.rev;
    assert.equal((await stored(p, "practice_a")).label.criteria.C1_red_flag.status, s);
  }
});
positive("every routing can be saved, and a complete label says so", async () => {
  const p = await labeler();
  let rev = 0;
  for (const routing of ["approve", "route", "request"]) {
    const r = await save(p, "practice_a", label("practice_a", routing), rev);
    assert.equal(r.status, 200, routing); assert.equal(r.json.complete, true); rev = r.json.rev;
  }
  assert.equal((await p.send("GET", "/api/me")).json.assignments[0].status, "complete");
});
positive("every id in the case can be cited as evidence", async () => {
  const p = await labeler();
  const l = blankLabel(); l.criteria.C2_conservative_4wk.evidence = idsOf("practice_a");
  assert.equal((await save(p, "practice_a", l)).status, 200);
  assert.deepEqual((await stored(p, "practice_a")).label.criteria.C2_conservative_4wk.evidence, idsOf("practice_a"));
});
positive("evidence cited twice is stored once; 60 entries are accepted", async () => {
  const p = await labeler();
  const [a] = idsOf("practice_a");
  const l = blankLabel(); l.criteria.C3_informs_management.evidence = Array(60).fill(a);
  assert.equal((await save(p, "practice_a", l)).status, 200);
  assert.deepEqual((await stored(p, "practice_a")).label.criteria.C3_informs_management.evidence, [a]);
});
positive("a gap of 500 characters is accepted, and spaces around it are trimmed", async () => {
  const p = await labeler();
  const l = label("practice_a", "request"); l.gap_missing = "  " + long(500) + "  ";
  assert.equal((await save(p, "practice_a", l)).status, 200);
  assert.equal((await stored(p, "practice_a")).label.gap_missing, long(500));
});
positive("a gap sent with a routing other than request is not stored", async () => {
  const p = await labeler();
  const l = label("practice_a", "approve"); l.gap_criterion = "C2"; l.gap_missing = "left over";
  await save(p, "practice_a", l);
  const s = (await stored(p, "practice_a")).label;
  assert.equal(s.gap_criterion, ""); assert.equal(s.gap_missing, "");
});
positive("extra fields in a label are not stored", async () => {
  const p = await labeler();
  const l = label(); l.note = "extra"; l.criteria.C5_made_up = { status: "supported", evidence: [] }; l.criteria.C1_red_flag.comment = "extra";
  await save(p, "practice_a", l);
  const s = (await stored(p, "practice_a")).label;
  assert.deepEqual(Object.keys(s).sort(), ["criteria", "gap_criterion", "gap_missing", "routing"]);
  assert.deepEqual(Object.keys(s.criteria), ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]);
  assert.deepEqual(Object.keys(s.criteria.C1_red_flag), ["status", "evidence"]);
});
positive("a criterion left out is stored as not answered yet", async () => {
  const p = await labeler();
  const l = label(); delete l.criteria.C4_no_duplicate_imaging;
  const r = await save(p, "practice_a", l);
  assert.equal(r.status, 200); assert.equal(r.json.complete, false);
  assert.deepEqual((await stored(p, "practice_a")).label.criteria.C4_no_duplicate_imaging, { status: "", evidence: [] });
});
positive("each save raises the version by one, and the answer is the label as stored", async () => {
  const p = await labeler();
  const a = await save(p, "practice_a", blankLabel(), 0);
  const b = await save(p, "practice_a", label(), 1);
  assert.equal(a.json.rev, 1); assert.equal(b.json.rev, 2);
  assert.deepEqual(b.json.label, label());
  assert.equal((await stored(p, "practice_a")).rev, 2);
});

// ---- 9. Saving a label: negative -------------------------------------------------------------------------------------

async function refusedSave(make, status, why, { rev, sha, caseId = "practice_a", setup } = {}) {
  const p = await labeler();
  let r0 = 0;
  if (setup) r0 = await setup(p);
  const l = label(caseId);
  const body = make(l);
  await refused(() => p.send("PUT", "/api/labels/" + caseId, body === undefined ? { label: l, rev: rev ?? r0, content_sha: sha ?? CONTENT.content_sha } : body),
    status, why, { person: p, caseId });
}
const withSaved = async p => (await save(p, "practice_a", blankLabel())).json.rev;   // a label already saved once
const L = fn => l => { fn(l); return undefined; };                                  // change the label, send the usual body
const B = body => () => body;                                                      // send this body as it is

negative("saving with a body that isn't JSON", async () => {
  const p = await labeler();
  await refused(() => p.send("PUT", "/api/labels/practice_a", undefined, { raw: "{not json" }), 400, /must be an object/, { person: p, caseId: "practice_a" });
});
negative("saving with a body that is a list", () => refusedSave(B([1, 2]), 400, /must be an object/));
negative("saving with no label", () => refusedSave(B({ rev: 0, content_sha: CONTENT.content_sha }), 400, /the label must be an object/));
negative("saving a label that is text", () => refusedSave(B({ label: "approve", rev: 0, content_sha: CONTENT.content_sha }), 400, /the label must be an object/));
negative("saving a label whose criteria are a list", () => refusedSave(L(l => { l.criteria = []; }), 400, /criteria must be an object/));
negative("saving a criterion given as text instead of a status and evidence", () => refusedSave(L(l => { l.criteria.C1_red_flag = "supported"; }), 400, /C1_red_flag must be an object/));
for (const s of ["Supported", "yes", "approved", " supported", "deny"]) {
  negative(`saving the unknown status "${s}"`, () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.status = s; }), 400, /unknown status/));
}
for (const [what, s] of [["a number", 1], ["true", true], ["false", false], ["a list", ["supported"]]]) {
  negative(`saving a status that is ${what}`, () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.status = s; }), 400, /status must be text|unknown status/));
}
negative("saving evidence that is text instead of a list", () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.evidence = idsOf("practice_a")[0]; }), 400, /evidence must be a list/));
negative("saving evidence with an id that isn't in the case", () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.evidence = ["Observation/made-up"]; }), 400, /is not an id in this case/));
negative("saving evidence with an id from another case", () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.evidence = [idsOf("practice_b")[0]]; }), 400, /is not an id in this case/));
negative("saving evidence with an id that isn't text", () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.evidence = [5]; }), 400, /is not an id in this case/));
negative("saving 61 evidence entries", () => refusedSave(L(l => { l.criteria.C2_conservative_4wk.evidence = Array(61).fill(idsOf("practice_a")[0]); }), 400, /too many evidence ids/));
for (const r of ["deny", "Approve", "approve ", "denied"]) {
  negative(`saving the unknown routing "${r}"`, () => refusedSave(L(l => { l.routing = r; }), 400, /unknown routing/));
}
for (const [what, r] of [["a number", 1], ["false", false]]) {
  negative(`saving a routing that is ${what}`, () => refusedSave(L(l => { l.routing = r; }), 400, /routing must be text|unknown routing/));
}
for (const g of ["C5", "c3", "C1 ", "C"]) {
  negative(`saving a request whose gap criterion is "${g}"`, () => refusedSave(L(l => { l.routing = "request"; l.gap_criterion = g; l.gap_missing = "x"; }), 400, /unknown gap criterion/));
}
negative("saving a request whose gap is 501 characters", () => refusedSave(L(l => { l.routing = "request"; l.gap_criterion = "C2"; l.gap_missing = long(501); }), 400, /longer than 500/));
negative("saving a request whose gap isn't text", () => refusedSave(L(l => { l.routing = "request"; l.gap_criterion = "C2"; l.gap_missing = 7; }), 400, /must be text/));
negative("saving without the content fingerprint", () => refusedSave(B({ label: label(), rev: 0 }), 409, /content_changed/));
negative("saving from a page loaded on older content", () => refusedSave(() => undefined, 409, /cases were updated.*content_changed/, { sha: "an-older-fingerprint" }));
negative("saving with no version", () => refusedSave(B({ label: label(), content_sha: CONTENT.content_sha }), 409, /stale/));
for (const [what, rev] of [["as text", "0"], ["too high", 5], ["below zero", -1], ["as a fraction", 0.5]]) {
  negative(`saving with the version ${what}`, () => refusedSave(() => undefined, 409, /stale/, { rev }));
}
negative("saving from an older copy (version 0 after a save made it 1)", () => refusedSave(() => undefined, 409, /changed in another tab.*stale/, { setup: withSaved, rev: 0 }));
negative("saving a case that isn't assigned", async () => {
  const p = await labeler();
  await refused(() => save(p, "practice_b", label("practice_b")), 404, /not assigned to you/);
});
negative("saving without the site's own header", async () => {
  const p = await labeler();
  await refused(() => p.send("PUT", "/api/labels/practice_a", { label: label(), rev: 0, content_sha: CONTENT.content_sha }, { header: false }), 403, /Missing request header/, { person: p, caseId: "practice_a" });
});
negative("saving without signing in", () => refused(() => send("PUT", "/api/labels/practice_a", { body: { label: label(), rev: 0, content_sha: CONTENT.content_sha } }), 401, /open your personal link/));
for (const [method, path] of [["POST", "/api/labels/practice_a"], ["PUT", "/api/labels/practice_a/submit"], ["DELETE", "/api/labels/practice_a/submit"], ["PATCH", "/api/labels/practice_a"]]) {
  negative(`${method} ${path.replace("/api/labels/", "a label ")} (a method the site doesn't offer)`, async () => {
    const p = await labeler();
    await refused(() => p.send(method, path, { label: label(), rev: 0, content_sha: CONTENT.content_sha }), 404, /Not found/, { person: p, caseId: "practice_a" });
  });
}
negative("five saves sent at the same moment from the same version: only one is kept", async () => {
  const p = await labeler();
  const rs = await Promise.all(["supported", "unsupported", "undeterminable", "supported", "unsupported"].map(s => {
    const l = blankLabel(); l.criteria.C1_red_flag.status = s; return save(p, "practice_a", l, 0);
  }));
  assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join(","));
  assert.ok(rs.filter(r => r.status !== 200).every(r => r.status === 409 && r.json.code === "stale"));
  const kept = rs.find(r => r.status === 200).json.label;
  assert.deepEqual((await stored(p, "practice_a")).label, kept, "the stored label is the one accepted");
  assert.equal((await stored(p, "practice_a")).rev, 1);
  assert.equal((await events(p.id)).filter(e => e.action === "label started").length, 1, "one log entry");
});

// ---- 10. Submitting (POST /api/labels/<case>/submit) -----------------------------------------------------------------

positive("a complete label submits: locked, with a log entry holding exactly what was locked", async () => {
  const p = await labeler();
  const r1 = await save(p, "practice_a", label());
  const r = await submit(p, "practice_a", label(), r1.json.rev);
  assert.equal(r.status, 200); assert.ok(r.json.submitted_at);
  assert.ok((await stored(p, "practice_a")).submitted_at);
  const e = (await events(p.id)).find(x => x.action === "label submitted");
  assert.deepEqual(e.detail.body, label()); assert.equal(e.detail.content_sha, CONTENT.content_sha);
});
positive("submitting straight away, with no earlier save, works", async () => {
  const p = await labeler();
  assert.equal((await submit(p, "practice_a", label(), 0)).status, 200);
});
for (const routing of ["approve", "route", "request"]) {
  positive(`a label routed "${routing}" can be submitted, and is in the download`, async () => {
    const p = await labeler();
    assert.equal((await submit(p, "practice_a", label("practice_a", routing), 0)).status, 200);
    const row = (await owner("GET", "/api/admin/export")).json.labels.find(l => l.labeler_id === p.id);
    assert.equal(row.label.routing, routing);
  });
}
async function refusedSubmit(change, status, why, setup) {
  const p = await labeler();
  const rev = setup ? await setup(p) : 0;
  const l = label("practice_a", "request"); change(l);
  await refused(() => submit(p, "practice_a", l, rev), status, why, { person: p, caseId: "practice_a" });
}
for (const k of ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]) {
  negative(`submitting with no status for ${k}`, () => refusedSubmit(l => { l.criteria[k].status = ""; }, 400, /Every criterion needs a status/));
}
negative("submitting with no routing", () => refusedSubmit(l => { l.routing = ""; }, 400, /Every criterion needs a status/));
negative("submitting a request with no gap criterion", () => refusedSubmit(l => { l.gap_criterion = ""; }, 400, /Every criterion needs a status/));
negative("submitting a request with no gap text", () => refusedSubmit(l => { l.gap_missing = ""; }, 400, /Every criterion needs a status/));
negative("submitting a request whose gap is only spaces", () => refusedSubmit(l => { l.gap_missing = "     "; }, 400, /Every criterion needs a status/));
negative("submitting a label with an unknown status", () => refusedSubmit(l => { l.criteria.C1_red_flag.status = "maybe"; }, 400, /unknown status/));
negative("submitting from an older copy", () => refusedSubmit(() => {}, 409, /stale/, async p => { await withSaved(p); return 0; }));
negative("submitting from a page loaded on older content", async () => {
  const p = await labeler();
  await refused(() => submit(p, "practice_a", label(), 0, "an-older-fingerprint"), 409, /content_changed/, { person: p, caseId: "practice_a" });
});
negative("submitting a case a second time", async () => {
  const p = await labeler();
  const r = await submit(p, "practice_a", label(), 0);
  await refused(() => submit(p, "practice_a", label(), r.json.rev), 409, /already submitted.*submitted/, { person: p, caseId: "practice_a" });
});
negative("saving a case after it was submitted", async () => {
  const p = await labeler();
  const r = await submit(p, "practice_a", label(), 0);
  await refused(() => save(p, "practice_a", blankLabel(), r.json.rev), 409, /already submitted/, { person: p, caseId: "practice_a" });
});
negative("submitting a case that isn't assigned", async () => {
  const p = await labeler();
  await refused(() => submit(p, "practice_b", label("practice_b"), 0), 404, /not assigned to you/);
});
negative("two submits sent at the same moment: only one locks the case", async () => {
  const p = await labeler();
  const rev = (await save(p, "practice_a", label())).json.rev;
  const a = label(); const b = label(); b.routing = "route";
  const rs = await Promise.all([submit(p, "practice_a", a, rev), submit(p, "practice_a", b, rev)]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  const won = rs.find(r => r.status === 200).json.label;
  assert.deepEqual((await stored(p, "practice_a")).label, won);
  assert.equal((await events(p.id)).filter(e => e.action === "label submitted").length, 1);
});

// ---- 11. The admin key ------------------------------------------------------------------------------------------------

positive("the right admin key opens the owner's data", async () => {
  assert.equal((await owner("GET", "/api/admin/state")).status, 200);
});
positive("the right admin key with spaces around it still works", async () => {
  assert.equal((await send("GET", "/api/admin/state", { auth: "Bearer   " + ADMIN_KEY + "  " })).status, 200);
});
positive("reading the owner's data needs no extra header", async () => {
  assert.equal((await send("GET", "/api/admin/state", { auth: "Bearer " + ADMIN_KEY, header: false })).status, 200);
});
for (const [what, auth] of [["no key", undefined], ["a wrong key", "Bearer wrong-key-wrong-key-wrong-key"], ["the key plus one character", "Bearer " + ADMIN_KEY + "x"],
  ["the key missing its last character", "Bearer " + ADMIN_KEY.slice(0, -1)], ["the key with \"bearer\" in small letters", "bearer " + ADMIN_KEY],
  ["the key without \"Bearer\"", ADMIN_KEY], ["the key sent as Basic", "Basic " + ADMIN_KEY], ["an empty key", "Bearer "]]) {
  negative(`the owner's data with ${what}`, () => refused(() => send("GET", "/api/admin/state", { auth }), 401, /admin key is wrong/));
}
negative("the admin key in the address instead of the header", () => refused(() => send("GET", "/api/admin/state?key=" + ADMIN_KEY), 401, /admin key is wrong/));
negative("an owner's change without the site's own header", () => refused(() => owner("POST", "/api/admin/labelers", { invited_name: "No Header", cases: [] }, { header: false }), 403, /Missing request header/));
negative("a labeler's sign-in cookie on the owner's data", async () => {
  const p = await labeler();
  await refused(() => p.send("GET", "/api/admin/state"), 401, /admin key is wrong/);
});

// ---- 12. Inviting (POST /api/admin/labelers) ----------------------------------------------------------------------

positive("inviting with a name only: a new person with an id and a personal link", async () => {
  const r = await owner("POST", "/api/admin/labelers", { invited_name: "Name Only" });
  assert.equal(r.status, 200);
  assert.match(r.json.id, /^lb_[0-9a-f]{16}$/);
  assert.match(r.json.link, /\/l\/[A-Za-z0-9_-]{43}$/);
  const me = (await owner("GET", "/api/admin/state")).json.labelers.find(l => l.id === r.json.id);
  assert.deepEqual(me.cases, []); assert.equal(me.consent_at, null);
});
positive("inviting at every limit: name 100, email 200, note 300 characters", async () => {
  const r = await owner("POST", "/api/admin/labelers", { invited_name: long(100), invited_email: long(200), note: long(300), cases: [] });
  assert.equal(r.status, 200);
});
positive("inviting with every case at once", async () => {
  const r = await owner("POST", "/api/admin/labelers", { invited_name: "All Cases", cases: CONTENT.order });
  const me = (await owner("GET", "/api/admin/state")).json.labelers.find(l => l.id === r.json.id);
  assert.deepEqual(me.cases.map(c => c.case), CONTENT.order);
});
positive("a case listed twice is assigned once", async () => {
  const r = await owner("POST", "/api/admin/labelers", { invited_name: "Twice", cases: ["case_01", "case_01"] });
  assert.equal(r.status, 200);
  assert.deepEqual((await owner("GET", "/api/admin/state")).json.labelers.find(l => l.id === r.json.id).cases.map(c => c.case), ["case_01"]);
});
positive("two invites with the same name are two people with different links", async () => {
  const a = await owner("POST", "/api/admin/labelers", { invited_name: "Same Name" });
  const b = await owner("POST", "/api/admin/labelers", { invited_name: "Same Name" });
  assert.notEqual(a.json.id, b.json.id); assert.notEqual(a.json.link, b.json.link);
});
positive("a name that looks like a database command is stored exactly as typed, and nothing else happens", async () => {
  const name = "Robert'); DROP TABLE labelers;--";
  const before = (await owner("GET", "/api/admin/state")).json.labelers.length;
  const r = await owner("POST", "/api/admin/labelers", { invited_name: name });
  const after = (await owner("GET", "/api/admin/state")).json.labelers;
  assert.equal(after.length, before + 1);
  assert.equal(after.find(l => l.id === r.json.id).invited_name, name);
});
const inviteNegatives = [
  ["no name", { cases: [] }, /please enter a name/],
  ["a name of only spaces", { invited_name: "   " }, /please enter a name/],
  ["a name of 101 characters", { invited_name: long(101) }, /longer than 100/],
  ["an email of 201 characters", { invited_name: "X", invited_email: long(201) }, /longer than 200/],
  ["a note of 301 characters", { invited_name: "X", note: long(301) }, /longer than 300/],
  ["a name that isn't text", { invited_name: ["X"] }, /must be text/],
  ["cases that aren't a list", { invited_name: "X", cases: "case_01" }, /cases must be a list/],
  ["an unknown case", { invited_name: "X", cases: ["case_13"] }, /unknown case/],
  ["a case named __proto__", { invited_name: "X", cases: ["__proto__"] }, /unknown case/],
  ["a case that isn't text", { invited_name: "X", cases: [1] }, /unknown case/],
];
for (const [what, body, why] of inviteNegatives) negative(`inviting with ${what}`, () => refused(() => owner("POST", "/api/admin/labelers", body), 400, why));
negative("inviting with a body that isn't JSON", () => refused(() => owner("POST", "/api/admin/labelers", undefined, { raw: "name=x" }), 400, /please enter a name/));

// ---- 13. Changing someone's cases (POST /api/admin/labelers/<id>/cases) -------------------------------------------

const act = (id, what, body = {}) => owner("POST", `/api/admin/labelers/${id}/${what}`, body);
positive("adding and removing cases that haven't been started", async () => {
  const p = await labeler(["case_01"]);
  assert.equal((await act(p.id, "cases", { cases: ["case_02", "practice_b"] })).status, 200);
  assert.deepEqual((await p.send("GET", "/api/me")).json.assignments.map(a => a.case), ["case_02", "practice_b"]);
});
positive("clearing all cases when none has been started", async () => {
  const p = await labeler(["case_01"]);
  assert.equal((await act(p.id, "cases", { cases: [] })).status, 200);
  assert.deepEqual((await p.send("GET", "/api/me")).json.assignments, []);
});
negative("taking away a case with a saved answer", async () => {
  const p = await labeler(["practice_a", "case_01"]);
  await save(p, "practice_a", blankLabel());
  await refused(() => act(p.id, "cases", { cases: ["case_01"] }), 400, /saved labels and stay assigned: Practice A/);
});
negative("changing cases with the list left out", async () => {
  const p = await labeler(["case_01"]);
  await refused(() => act(p.id, "cases", {}), 400, /cases must be a list/);
});
negative("changing cases to something that isn't a list", async () => {
  const p = await labeler(["case_01"]);
  await refused(() => act(p.id, "cases", { cases: "case_02" }), 400, /cases must be a list/);
});
negative("changing cases to an unknown case", async () => {
  const p = await labeler(["case_01"]);
  await refused(() => act(p.id, "cases", { cases: ["case_00"] }), 400, /unknown case/);
});
for (const what of ["cases", "link", "revoke", "reopen", "remove", "clear"]) {
  negative(`"${what}" for a person who doesn't exist`, () => refused(() => act("lb_0000000000000000", what, { cases: [], case: "case_01", reason: "x" }), 404, /No such labeler/));
  negative(`"${what}" with a badly formed person id`, () => refused(() => act("someone", what, { cases: [] }), 404, /Not found/));
}

// ---- 14. Links ----------------------------------------------------------------------------------------------------------

positive("a new link works at once, and the old one stops", async () => {
  const p = await labeler();
  const r = await act(p.id, "link");
  assert.equal(r.status, 200);
  assert.equal((await send("POST", "/api/session", { body: { token: r.json.link.split("/l/")[1] } })).status, 200);
  assert.equal((await send("POST", "/api/session", { body: { token: p.token } })).status, 404);
});
positive("turning a link off stops it; a new link turns the person back on", async () => {
  const p = await labeler();
  assert.equal((await act(p.id, "revoke")).status, 200);
  assert.ok((await owner("GET", "/api/admin/state")).json.labelers.find(l => l.id === p.id).revoked_at);
  const r = await act(p.id, "link");
  assert.equal((await owner("GET", "/api/admin/state")).json.labelers.find(l => l.id === p.id).revoked_at, null);
  assert.equal((await send("POST", "/api/session", { body: { token: r.json.link.split("/l/")[1] } })).status, 200);
});

// ---- 15. Reopening a submitted case (POST /api/admin/labelers/<id>/reopen) ---------------------------------------------

async function submittedPerson() { const p = await labeler(); const r = await submit(p, "practice_a", label(), 0); return { p, rev: r.json.rev }; }
positive("reopening with a reason: editable again, version raised, reason in the log", async () => {
  const { p, rev } = await submittedPerson();
  assert.equal((await act(p.id, "reopen", { case: "practice_a", reason: "fix C4" })).status, 200);
  const s = await stored(p, "practice_a");
  assert.equal(s.submitted_at, null); assert.equal(s.rev, rev + 1);
  assert.equal((await save(p, "practice_a", label(), s.rev)).status, 200);
  assert.equal((await events(p.id)).find(e => e.action === "label reopened").detail.reason, "fix C4");
});
for (const [what, reason, why] of [["no reason", undefined, /please give a reason/], ["a reason of only spaces", "   ", /please give a reason/], ["a reason of 301 characters", long(301), /longer than 300/]]) {
  negative(`reopening with ${what}`, async () => {
    const { p } = await submittedPerson();
    await refused(() => act(p.id, "reopen", { case: "practice_a", reason }), 400, why, { person: p, caseId: "practice_a" });
  });
}
negative("reopening a case that isn't submitted", async () => {
  const p = await labeler();
  await save(p, "practice_a", label());
  await refused(() => act(p.id, "reopen", { case: "practice_a", reason: "x" }), 404, /not submitted/, { person: p, caseId: "practice_a" });
});
for (const [what, c] of [["an unknown case", "case_99"], ["a case that isn't text", 5], ["a case they don't have", "practice_b"]]) {
  negative(`reopening ${what}`, async () => {
    const { p } = await submittedPerson();
    await refused(() => act(p.id, "reopen", { case: c, reason: "x" }), 404, /not submitted/, { person: p, caseId: "practice_a" });
  });
}

// ---- 16. Removing a person on request (POST /api/admin/labelers/<id>/remove) -------------------------------------------

positive("removing a person: they, their cases, and their labels are gone; the log keeps only what happened", async () => {
  const { p } = await submittedPerson();
  assert.equal((await act(p.id, "remove")).status, 200);
  assert.ok(!(await owner("GET", "/api/admin/state")).json.labelers.some(l => l.id === p.id));
  assert.ok(!(await owner("GET", "/api/admin/export")).json.labels.some(l => l.labeler_id === p.id));
  const mine = await events(p.id);
  assert.ok(mine.every(e => e.detail === null)); assert.equal(mine[0].action, "details removed on request");
  assert.equal((await p.send("GET", "/api/me")).status, 401);
});
negative("removing the same person twice", async () => {
  const p = await labeler();
  await act(p.id, "remove");
  await refused(() => act(p.id, "remove"), 404, /No such labeler/);
});

// ---- 17. The download and the activity log --------------------------------------------------------------------------

positive("the download holds submitted labels only, each with who, when, and which version of the case", async () => {
  const p = await labeler(["practice_a", "practice_b"]);
  await save(p, "practice_b", label("practice_b"));
  await submit(p, "practice_a", label(), 0);
  const rows = (await owner("GET", "/api/admin/export")).json.labels.filter(l => l.labeler_id === p.id);
  assert.deepEqual(rows.map(r => r.case), ["practice_a"]);
  for (const f of ["credit_name", "consent_at", "submitted_at", "revision", "case_sha", "content_sha", "kind", "label"]) assert.ok(f in rows[0], f);
  assert.equal(rows[0].case_sha, CONTENT.cases.practice_a.case_sha);
});
positive("the activity log lists the newest entry first, at most 500", async () => {
  const ev = (await owner("GET", "/api/admin/events")).json.events;
  assert.ok(ev.length <= 500);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].id > ev[i].id);
});
for (const [method, path] of [["GET", "/api/admin/labelers"], ["POST", "/api/admin/state"], ["POST", "/api/admin/export"], ["GET", "/api/admin/nothing"], ["DELETE", "/api/admin/events"]]) {
  negative(`${method} ${path} (not something the owner's page does)`, () => refused(() => owner(method, path, method === "GET" ? undefined : {}), 404, /Not found/));
}

// ---- 18. A labeler clears one of their cases (DELETE /api/labels/<case>) --------------------------------------------

const clearOwn = (p, caseId, body) => p.send("DELETE", "/api/labels/" + caseId, body);
positive("a labeler clears a saved case: it reads as empty and not started, and the log keeps what was cleared", async () => {
  const p = await labeler(["practice_a", "practice_b"]);
  const r1 = await save(p, "practice_a", label());
  await save(p, "practice_b", label("practice_b"));
  const r = await clearOwn(p, "practice_a", { rev: r1.json.rev });
  assert.equal(r.status, 200); assert.equal(r.json.rev, 0);
  assert.deepEqual(await stored(p, "practice_a"), { label: null, rev: 0 });
  const me = (await p.send("GET", "/api/me")).json.assignments;
  assert.equal(me.find(a => a.case === "practice_a").status, "not started", "still assigned, back to not started");
  assert.equal(me.find(a => a.case === "practice_b").status, "complete", "the other case is untouched");
  const e = (await events(p.id)).find(x => x.action === "label cleared by the labeler");
  assert.equal(e.case_id, "practice_a"); assert.deepEqual(e.detail.was, label());
});
positive("a cleared case can be labeled and submitted again, starting from version 0", async () => {
  const p = await labeler();
  const r1 = await save(p, "practice_a", label());
  await clearOwn(p, "practice_a", { rev: r1.json.rev });
  const r2 = await save(p, "practice_a", blankLabel(), 0);
  assert.equal(r2.status, 200); assert.equal(r2.json.rev, 1);
  assert.equal((await submit(p, "practice_a", label("practice_a", "route"), 1)).status, 200);
  assert.equal((await owner("GET", "/api/admin/export")).json.labels.find(l => l.labeler_id === p.id).label.routing, "route");
});
positive("clearing a case with nothing saved is allowed and changes nothing", async () => {
  const p = await labeler();
  const before = await world();
  assert.equal((await clearOwn(p, "practice_a", { rev: 0 })).status, 200);
  assert.deepEqual(await world(), before);
});
negative("a labeler clearing a submitted case", async () => {
  const { p, rev } = await submittedPerson();
  await refused(() => clearOwn(p, "practice_a", { rev }), 409, /already submitted.*ask the person who invited you.*submitted/, { person: p, caseId: "practice_a" });
});
negative("a labeler clearing from an older copy (another tab saved since)", async () => {
  const p = await labeler();
  await save(p, "practice_a", blankLabel());
  await save(p, "practice_a", label(), 1);
  await refused(() => clearOwn(p, "practice_a", { rev: 1 }), 409, /changed in another tab.*stale/, { person: p, caseId: "practice_a" });
});
for (const [what, body] of [["no version", {}], ["the version as text", { rev: "1" }]]) {
  negative(`a labeler clearing with ${what}`, async () => {
    const p = await labeler();
    await save(p, "practice_a", label());
    await refused(() => clearOwn(p, "practice_a", body), 409, /stale/, { person: p, caseId: "practice_a" });
  });
}
negative("a labeler clearing with a body that isn't JSON", async () => {
  const p = await labeler();
  await save(p, "practice_a", label());
  await refused(() => p.send("DELETE", "/api/labels/practice_a", undefined, { raw: "rev=1" }), 400, /must be an object/, { person: p, caseId: "practice_a" });
});
negative("a labeler clearing a case that isn't assigned", async () => {
  const p = await labeler();
  await refused(() => clearOwn(p, "practice_b", { rev: 0 }), 404, /not assigned to you/);
});
negative("a labeler clearing without the site's own header", async () => {
  const p = await labeler();
  const r = await save(p, "practice_a", label());
  await refused(() => p.send("DELETE", "/api/labels/practice_a", { rev: r.json.rev }, { header: false }), 403, /Missing request header/, { person: p, caseId: "practice_a" });
});
negative("clearing without signing in", () => refused(() => send("DELETE", "/api/labels/practice_a", { body: { rev: 1 } }), 401, /open your personal link/));
negative("clearing before agreeing on the welcome page", async () => {
  const p = await labeler(["practice_a"], { consent: false });
  await refused(() => clearOwn(p, "practice_a", { rev: 0 }), 403, /complete the welcome page first/);
});

// ---- 19. The owner clears one case for a labeler (POST /api/admin/labelers/<id>/clear) -------------------------------

positive("the owner clears a submitted case with a reason: out of the download, still assigned, and it can be redone", async () => {
  const { p } = await submittedPerson();
  const r = await act(p.id, "clear", { case: "practice_a", reason: "wants to redo it" });
  assert.equal(r.status, 200);
  assert.ok(!(await owner("GET", "/api/admin/export")).json.labels.some(l => l.labeler_id === p.id));
  assert.deepEqual(await stored(p, "practice_a"), { label: null, rev: 0 });
  assert.equal((await p.send("GET", "/api/me")).json.assignments[0].status, "not started");
  const e = (await events(p.id)).find(x => x.action === "label cleared");
  assert.equal(e.actor, "owner"); assert.equal(e.detail.reason, "wants to redo it");
  assert.deepEqual(e.detail.was, label()); assert.ok(e.detail.was_submitted_at);
  assert.equal((await submit(p, "practice_a", label("practice_a", "route"), 0)).status, 200, "the labeler can submit it again");
});
positive("the owner clears a case that was saved but not submitted", async () => {
  const p = await labeler();
  await save(p, "practice_a", blankLabel());
  assert.equal((await act(p.id, "clear", { case: "practice_a", reason: "assigned by mistake" })).status, 200);
  assert.deepEqual(await stored(p, "practice_a"), { label: null, rev: 0 });
});
negative("a labeler's open page saving over a case the owner just cleared", async () => {
  const p = await labeler();
  const r = await save(p, "practice_a", label());
  await act(p.id, "clear", { case: "practice_a", reason: "start again" });
  await refused(() => save(p, "practice_a", label(), r.json.rev), 409, /stale/, { person: p, caseId: "practice_a" });
});
for (const [what, reason, why] of [["no reason", undefined, /please give a reason/], ["a reason of only spaces", "   ", /please give a reason/], ["a reason of 301 characters", long(301), /longer than 300/]]) {
  negative(`the owner clearing with ${what}`, async () => {
    const { p } = await submittedPerson();
    await refused(() => act(p.id, "clear", { case: "practice_a", reason }), 400, why, { person: p, caseId: "practice_a" });
  });
}
for (const [what, c] of [["a case with nothing saved", "practice_b"], ["an unknown case", "case_99"], ["a case that isn't text", 7], ["no case", undefined]]) {
  negative(`the owner clearing ${what}`, async () => {
    const p = await labeler(["practice_a", "practice_b"]);
    await save(p, "practice_a", label());
    await refused(() => act(p.id, "clear", { case: c, reason: "x" }), 404, /no saved answers to clear/, { person: p, caseId: "practice_a" });
  });
}
positive("removing a person also wipes what earlier clears recorded about their answers", async () => {
  const { p } = await submittedPerson();
  await act(p.id, "clear", { case: "practice_a", reason: "redo" });
  const before = (await events(p.id)).find(e => e.action === "label cleared");
  assert.ok(before && before.detail.reason === "redo" && before.detail.was, "the clear was logged against this person, with details");
  await act(p.id, "remove");
  const after = await events(p.id);
  assert.ok(after.some(e => e.action === "label cleared"), "the log still shows that a clear happened");
  assert.ok(after.every(e => e.detail === null), "but none of its details");
});
