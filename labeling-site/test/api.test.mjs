// Tests of the labeling site through its HTTP interface, against a local Worker and a local D1 database
// (wrangler dev --local; nothing touches Cloudflare). Run from labeling-site/: npm test
// The labels below are made-up test values; they describe no golden case.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { CONTENT } from "../src/content.generated.js";
import { startSite, SITE, ADMIN_KEY, ENV } from "./local-site.mjs";

let site, BASE, persist;

// Cleanup waits for setup to finish. When a name filter leaves this file with no test to run, Node's test runner
// starts the cleanup while setup is still going; without the wait, the local site (and browser) would be left
// running and the run would never end.
let ready;
before(() => (ready = (async () => { site = await startSite(); BASE = site.base; persist = site.persist; })()));
after(async () => { await ready.catch(() => {}); if (site) site.stop(); });

const H = { "X-Labeling": "1", "Content-Type": "application/json" };
const admin = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { ...H, Authorization: "Bearer " + ADMIN_KEY }, body: body && JSON.stringify(body) });
const as = (cookie) => (path, method = "GET", body) => fetch(BASE + path, { method, headers: { ...H, Cookie: cookie }, body: body && JSON.stringify(body) });
async function invite(name, cases) {
  const r = await admin("/api/admin/labelers", "POST", { invited_name: name, cases });
  assert.equal(r.status, 200);
  return r.json();
}
const local = link => link.replace(/^https?:\/\/[^/]+/, BASE);
const tokenOf = link => link.split("/l/")[1];
// Opening a link only shows a Continue page; the button's request starts the session.
async function signIn(link) {
  const page = await fetch(local(link), { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("set-cookie"), null, "opening the link sets nothing");
  const r = await fetch(BASE + "/api/session", { method: "POST", headers: H, body: JSON.stringify({ token: tokenOf(link) }) });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie");
  assert.match(set, /^__Host-lab_session=/); assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Lax/); assert.match(set, /Path=\//);
  return set.split(";")[0];
}
const put = (go, caseId, label, rev, sha = CONTENT.content_sha) => go("/api/labels/" + caseId, "PUT", { label, rev, content_sha: sha });
const submit = (go, caseId, label, rev) => go("/api/labels/" + caseId + "/submit", "POST", { label, rev, content_sha: CONTENT.content_sha });
function fullLabel(caseId, routing = "approve") {
  const v = CONTENT.cases[caseId].view;
  return {
    criteria: {
      C1_red_flag: { status: "unsupported", evidence: [] },
      C2_conservative_4wk: { status: "supported", evidence: [v.sections[0].items[0].id] },
      C3_informs_management: { status: "supported", evidence: [v.note.paragraphs[0].id] },
      C4_no_duplicate_imaging: { status: "supported", evidence: [] },
    },
    routing, gap_criterion: routing === "request" ? "C3" : "", gap_missing: routing === "request" ? "the plan" : "",
  };
}

test("pages carry the security headers, and the landing page needs no sign-in", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(r.headers.get("content-security-policy"), /script-src 'none'/);
  const a = await fetch(BASE + "/admin");
  assert.ok(a.headers.get("content-security-policy").includes(`script-src '${CONTENT.script_hashes.admin}'`), "only the admin page's own script may run");
  assert.equal(a.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(await r.text(), /Invited labelers only/);
});

test("without a session: the app, the training, and the labeler API are closed", async () => {
  assert.equal((await fetch(BASE + "/app")).status, 401);
  assert.equal((await fetch(BASE + "/training")).status, 401);
  assert.equal((await fetch(BASE + "/api/me", { headers: H })).status, 401);
  assert.equal((await fetch(BASE + "/l/not-a-real-token", { redirect: "manual" })).status, 404);
  assert.equal((await fetch(BASE + "/api/session", { method: "POST", headers: H, body: JSON.stringify({ token: "not-a-real-token" }) })).status, 404);
  assert.equal((await fetch(BASE + "/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403, "the session request needs the site's header");
});

test("opening a link changes nothing until Continue: no cookie, no sign-in recorded", async () => {
  const { link, id } = await invite("Test Labeler Scan", []);
  const before = (await (await admin("/api/admin/events")).json()).events.filter(e => e.labeler_id === id).length;
  const page = await fetch(local(link));
  assert.match(await page.text(), /Test Labeler Scan/);
  const after = (await (await admin("/api/admin/events")).json()).events.filter(e => e.labeler_id === id).length;
  assert.equal(after, before, "a link scanner's visit leaves no trace");
});

test("the admin API needs the key, and every change needs the site's own header", async () => {
  assert.equal((await fetch(BASE + "/api/admin/state", { headers: H })).status, 401);
  assert.equal((await fetch(BASE + "/api/admin/state", { headers: { ...H, Authorization: "Bearer wrong-key-wrong-key-wrong-key" } })).status, 401);
  assert.equal((await admin("/api/admin/state")).status, 200);
  const r = await fetch(BASE + "/api/admin/labelers", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + ADMIN_KEY }, body: "{}" });
  assert.equal(r.status, 403);
});

test("a labeler's whole path: consent, training, assigned cases only, save, submit, lock", async () => {
  const { link, id } = await invite("Test Labeler A", ["case_01", "practice_a"]);
  assert.match(link, /\/l\/[A-Za-z0-9_-]{40,}$/);
  const go = as(await signIn(link));
  const app = await fetch(BASE + "/app", { headers: { Cookie: (await signIn(link)) } });
  assert.equal(app.status, 200);
  assert.ok(app.headers.get("content-security-policy").includes(CONTENT.script_hashes.app));

  let me = await (await go("/api/me")).json();
  assert.equal(me.labeler.consent_at, null);
  assert.deepEqual(me.assignments.map(a => a.case), ["case_01", "practice_a"]);
  assert.equal((await go("/api/cases")).status, 403, "cases stay closed before consent");
  assert.equal((await go("/api/consent", "POST", { credit_name: "Dr. Test", agree_credit: true })).status, 400, "both boxes are needed");
  assert.equal((await go("/api/consent", "POST", { credit_name: "Dr. Test", role: "RN", agree_credit: true, agree_rules: true })).status, 200);
  assert.equal((await go("/api/training", "POST", { done: true })).status, 200);

  const cases = await (await go("/api/cases")).json();
  assert.deepEqual(cases.cases.map(c => c.case), ["case_01", "practice_a"]);
  assert.equal(cases.content_sha, CONTENT.content_sha);
  assert.ok(!JSON.stringify(cases).includes("intended"), "no answer key in what a labeler receives");
  assert.equal((await go("/api/labels/case_02")).status, 404, "an unassigned case is closed");
  assert.equal((await put(go, "case_02", fullLabel("case_02"), 0)).status, 404);
  assert.equal((await put(go, "__proto__", fullLabel("case_01"), 0)).status, 404);

  const bad = fullLabel("case_01"); bad.criteria.C1_red_flag.evidence = ["Observation/not-in-this-case"];
  assert.equal((await put(go, "case_01", bad, 0)).status, 400, "evidence must be ids in the case");
  const odd = fullLabel("case_01"); odd.routing = "deny";
  assert.equal((await put(go, "case_01", odd, 0)).status, 400, "deny is not an outcome");
  let r = await put(go, "case_01", fullLabel("case_01"), 0, "not-the-content");
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "content_changed", "a page loaded on older content can't save");

  const part = fullLabel("case_01"); part.routing = "";
  r = await put(go, "case_01", part, 0);
  assert.equal(r.status, 200); let j = await r.json(); assert.equal(j.complete, false); assert.equal(j.rev, 1);
  r = await put(go, "case_01", fullLabel("case_01"), 0);
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "stale", "a save from an older copy is refused, not merged");
  assert.equal((await submit(go, "case_01", part, 1)).status, 400, "an incomplete label can't be submitted");
  r = await put(go, "case_01", fullLabel("case_01", "request"), 1);
  j = await r.json(); assert.equal(j.complete, true); assert.equal(j.rev, 2);
  const got = await (await go("/api/labels/case_01")).json();
  assert.equal(got.label.routing, "request"); assert.equal(got.label.gap_criterion, "C3"); assert.equal(got.rev, 2);
  // The submit carries the label as the page shows it: that, not an earlier save, is what gets locked.
  const shown = fullLabel("case_01", "request"); shown.gap_missing = "the plan, as finally typed";
  r = await submit(go, "case_01", shown, 2);
  assert.equal(r.status, 200); assert.equal((await r.json()).label.gap_missing, "the plan, as finally typed");
  assert.equal((await go("/api/labels/case_01")).status, 200);
  assert.equal((await put(go, "case_01", fullLabel("case_01"), 3)).status, 409, "a submitted label is locked");
  assert.equal((await submit(go, "case_01", fullLabel("case_01"), 3)).status, 409);
  me = await (await go("/api/me")).json();
  assert.equal(me.assignments.find(a => a.case === "case_01").status, "submitted");
  assert.ok(me.labeler.training_done_at);

  const exp = await (await admin("/api/admin/export")).json();
  const row = exp.labels.find(l => l.labeler_id === id && l.case === "case_01");
  assert.equal(row.credit_name, "Dr. Test"); assert.equal(row.role, "RN"); assert.equal(row.label.routing, "request");
  assert.equal(row.label.gap_missing, "the plan, as finally typed");
  assert.equal(row.content_sha, CONTENT.content_sha); assert.equal(row.case_sha, CONTENT.cases.case_01.case_sha); assert.equal(row.kind, "golden");
  const ev = (await (await admin("/api/admin/events")).json()).events.find(e => e.labeler_id === id && e.action === "label submitted");
  assert.equal(ev.detail.body.gap_missing, "the plan, as finally typed", "the audit trail records exactly what was locked");
  assert.ok(!exp.labels.some(l => l.labeler_id === id && l.case === "practice_a"), "only submitted labels are exported");
});

test("labelers never see each other's labels", async () => {
  const a = await invite("Test Labeler B", ["case_03"]);
  const b = await invite("Test Labeler C", ["case_03"]);
  const goA = as(await signIn(a.link)), goB = as(await signIn(b.link));
  for (const go of [goA, goB]) await go("/api/consent", "POST", { credit_name: "X", agree_credit: true, agree_rules: true });
  assert.equal((await put(goA, "case_03", fullLabel("case_03"), 0)).status, 200);
  const seen = await (await goB("/api/labels/case_03")).json();
  assert.equal(seen.label, null, "B sees no label for case 03, though A saved one");
});

test("the owner can reopen a submitted case with a reason, turn a link off, and replace it", async () => {
  const { link, id } = await invite("Test Labeler D", ["case_04"]);
  const cookie = await signIn(link), go = as(cookie);
  await go("/api/consent", "POST", { credit_name: "D", agree_credit: true, agree_rules: true });
  assert.equal((await put(go, "case_04", fullLabel("case_04"), 0)).status, 200);
  assert.equal((await submit(go, "case_04", fullLabel("case_04"), 1)).status, 200);
  assert.equal((await admin(`/api/admin/labelers/${id}/reopen`, "POST", { case: "case_04" })).status, 400, "a reason is required");
  assert.equal((await admin(`/api/admin/labelers/${id}/reopen`, "POST", { case: "case_04", reason: "typo in the gap" })).status, 200);
  const now4 = await (await go("/api/labels/case_04")).json();
  assert.equal(now4.submitted_at, null);
  assert.equal((await put(go, "case_04", fullLabel("case_04"), now4.rev)).status, 200, "editable again after reopening");
  assert.equal((await admin(`/api/admin/labelers/${id}/cases`, "POST", { cases: [] })).status, 400, "a case with a saved label stays assigned");

  assert.equal((await admin(`/api/admin/labelers/${id}/revoke`, "POST", {})).status, 200);
  assert.equal((await go("/api/me")).status, 401, "a turned-off link signs nobody in, even with an old session");
  assert.equal((await fetch(local(link), { redirect: "manual" })).status, 404);
  const fresh = await (await admin(`/api/admin/labelers/${id}/link`, "POST", {})).json();
  const go2 = as(await signIn(fresh.link));
  assert.equal((await go2("/api/me")).status, 200);
  assert.equal((await fetch(local(link), { redirect: "manual" })).status, 404, "the old link stays dead");

  const { events } = await (await admin("/api/admin/events")).json();
  const mine = events.filter(e => e.labeler_id === id).map(e => e.action);
  for (const a of ["labeler invited", "consent", "label submitted", "label reopened", "link turned off", "new link made (the old one stops working)"])
    assert.ok(mine.some(x => x.startsWith(a)), a);
  assert.equal(events.find(e => e.action === "label reopened" && e.labeler_id === id).detail.reason, "typo in the gap");
});

test("removing a person on request deletes their labels and details, and clears their audit details", async () => {
  const { link, id } = await invite("Test Labeler E", ["case_05"]);
  const go = as(await signIn(link));
  await go("/api/consent", "POST", { credit_name: "Ms. Remove Me", role: "RN", agree_credit: true, agree_rules: true });
  assert.equal((await put(go, "case_05", fullLabel("case_05"), 0)).status, 200);
  assert.equal((await submit(go, "case_05", fullLabel("case_05"), 1)).status, 200);
  assert.equal((await admin(`/api/admin/labelers/${id}/remove`, "POST", {})).status, 200);
  const state = await (await admin("/api/admin/state")).json();
  assert.ok(!state.labelers.some(l => l.id === id));
  const exp = await (await admin("/api/admin/export")).json();
  assert.ok(!exp.labels.some(l => l.labeler_id === id));
  const { events } = await (await admin("/api/admin/events")).json();
  const theirs = events.filter(e => e.labeler_id === id);
  assert.ok(theirs.length >= 4);
  assert.ok(theirs.every(e => e.detail === null), "no name, role, or label left in the audit trail");
  assert.ok(!JSON.stringify(events).includes("Remove Me"));
  assert.ok(theirs.some(e => e.action === "details removed on request"));
  assert.equal((await go("/api/me")).status, 401);
});

test("the audit trail can't be deleted or rewritten in the database", () => {
  for (const sql of ["DELETE FROM events", "UPDATE events SET action = 'x'"]) {
    let failed = false;
    try { execFileSync("npx", ["wrangler", "d1", "execute", "prior-auth-labeling", "--local", "--persist-to", persist, "--command", sql], { cwd: SITE, env: ENV, stdio: "pipe" }); }
    catch (e) { failed = /append-only/.test(String(e.stdout) + String(e.stderr)); }
    assert.ok(failed, sql);
  }
});

test("the admin API rejects unknown cases and over-long text", async () => {
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "X", cases: ["case_99"] })).status, 400);
  for (const c of ["__proto__", "constructor", "toString"]) assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "X", cases: [c] })).status, 400, c);
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "x".repeat(101), cases: [] })).status, 400);
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "", cases: [] })).status, 400);
});
