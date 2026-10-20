// Tests of the labeling site through its HTTP interface, against a local Worker and a local D1 database
// (wrangler dev --local; nothing touches Cloudflare). Run from labeling-site/: npm test
// The labels below are made-up test values; they describe no golden case.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT } from "../src/content.generated.js";

const SITE = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 18700 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = "test-admin-key-0123456789-abcdefghij";
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };
let dev, persist;

before(async () => {
  persist = mkdtempSync(join(tmpdir(), "labeling-site-"));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "prior-auth-labeling", "--local", "--persist-to", persist],
    { cwd: SITE, env: ENV, stdio: "ignore" });
  dev = spawn("npx", ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", persist,
    "--var", `ADMIN_KEY:${ADMIN_KEY}`], { cwd: SITE, env: ENV, stdio: "ignore", detached: true });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + "/")).ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("the local Worker did not start");
});
after(() => {
  try { process.kill(-dev.pid); } catch (e) {}
  rmSync(persist, { recursive: true, force: true });
});

const H = { "X-Labeling": "1", "Content-Type": "application/json" };
const admin = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { ...H, Authorization: "Bearer " + ADMIN_KEY }, body: body && JSON.stringify(body) });
const as = (cookie) => (path, method = "GET", body) => fetch(BASE + path, { method, headers: { ...H, Cookie: cookie }, body: body && JSON.stringify(body) });
async function invite(name, cases) {
  const r = await admin("/api/admin/labelers", "POST", { invited_name: name, cases });
  assert.equal(r.status, 200);
  return r.json();
}
async function signIn(link) {
  const r = await fetch(link.replace(/^https?:\/\/[^/]+/, BASE), { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/app");
  const set = r.headers.get("set-cookie");
  assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Lax/);
  return set.split(";")[0];
}
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
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(await r.text(), /Invited labelers only/);
});

test("without a session: the app, the training, and the labeler API are closed", async () => {
  assert.equal((await fetch(BASE + "/app")).status, 401);
  assert.equal((await fetch(BASE + "/training")).status, 401);
  assert.equal((await fetch(BASE + "/api/me", { headers: H })).status, 401);
  assert.equal((await fetch(BASE + "/l/not-a-real-token", { redirect: "manual" })).status, 404);
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
  assert.equal((await fetch(BASE + "/app", { headers: { Cookie: (await signIn(link)) } })).status, 200);

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
  assert.equal((await go("/api/labels/case_02", "PUT", fullLabel("case_02"))).status, 404);

  const bad = fullLabel("case_01"); bad.criteria.C1_red_flag.evidence = ["Observation/not-in-this-case"];
  assert.equal((await go("/api/labels/case_01", "PUT", bad)).status, 400, "evidence must be ids in the case");
  const odd = fullLabel("case_01"); odd.routing = "deny";
  assert.equal((await go("/api/labels/case_01", "PUT", odd)).status, 400, "deny is not an outcome");

  const part = fullLabel("case_01"); part.routing = "";
  let r = await go("/api/labels/case_01", "PUT", part);
  assert.equal(r.status, 200); assert.equal((await r.json()).complete, false);
  assert.equal((await go("/api/labels/case_01/submit", "POST", {})).status, 400, "an incomplete label can't be submitted");
  r = await go("/api/labels/case_01", "PUT", fullLabel("case_01", "request"));
  assert.equal((await r.json()).complete, true);
  const got = await (await go("/api/labels/case_01")).json();
  assert.equal(got.label.routing, "request"); assert.equal(got.label.gap_criterion, "C3");
  assert.equal((await go("/api/labels/case_01/submit", "POST", {})).status, 200);
  assert.equal((await go("/api/labels/case_01", "PUT", fullLabel("case_01"))).status, 409, "a submitted label is locked");
  assert.equal((await go("/api/labels/case_01/submit", "POST", {})).status, 409);
  me = await (await go("/api/me")).json();
  assert.equal(me.assignments.find(a => a.case === "case_01").status, "submitted");
  assert.ok(me.labeler.training_done_at);

  const exp = await (await admin("/api/admin/export")).json();
  const row = exp.labels.find(l => l.labeler_id === id && l.case === "case_01");
  assert.equal(row.credit_name, "Dr. Test"); assert.equal(row.role, "RN"); assert.equal(row.label.routing, "request");
  assert.equal(row.content_sha, CONTENT.content_sha);
  assert.ok(!exp.labels.some(l => l.labeler_id === id && l.case === "practice_a"), "only submitted labels are exported");
});

test("labelers never see each other's labels", async () => {
  const a = await invite("Test Labeler B", ["case_03"]);
  const b = await invite("Test Labeler C", ["case_03"]);
  const goA = as(await signIn(a.link)), goB = as(await signIn(b.link));
  for (const go of [goA, goB]) await go("/api/consent", "POST", { credit_name: "X", agree_credit: true, agree_rules: true });
  await goA("/api/labels/case_03", "PUT", fullLabel("case_03"));
  const seen = await (await goB("/api/labels/case_03")).json();
  assert.equal(seen.label, null, "B sees no label for case 03, though A saved one");
});

test("the owner can reopen a submitted case with a reason, turn a link off, and replace it", async () => {
  const { link, id } = await invite("Test Labeler D", ["case_04"]);
  const cookie = await signIn(link), go = as(cookie);
  await go("/api/consent", "POST", { credit_name: "D", agree_credit: true, agree_rules: true });
  await go("/api/labels/case_04", "PUT", fullLabel("case_04"));
  await go("/api/labels/case_04/submit", "POST", {});
  assert.equal((await admin(`/api/admin/labelers/${id}/reopen`, "POST", { case: "case_04" })).status, 400, "a reason is required");
  assert.equal((await admin(`/api/admin/labelers/${id}/reopen`, "POST", { case: "case_04", reason: "typo in the gap" })).status, 200);
  assert.equal((await go("/api/labels/case_04", "PUT", fullLabel("case_04"))).status, 200, "editable again after reopening");
  assert.equal((await admin(`/api/admin/labelers/${id}/cases`, "POST", { cases: [] })).status, 400, "a case with a saved label stays assigned");

  assert.equal((await admin(`/api/admin/labelers/${id}/revoke`, "POST", {})).status, 200);
  assert.equal((await go("/api/me")).status, 401, "a turned-off link signs nobody in, even with an old session");
  assert.equal((await fetch(link.replace(/^https?:\/\/[^/]+/, BASE), { redirect: "manual" })).status, 404);
  const fresh = await (await admin(`/api/admin/labelers/${id}/link`, "POST", {})).json();
  const go2 = as(await signIn(fresh.link));
  assert.equal((await go2("/api/me")).status, 200);
  assert.equal((await fetch(link.replace(/^https?:\/\/[^/]+/, BASE), { redirect: "manual" })).status, 404, "the old link stays dead");

  const { events } = await (await admin("/api/admin/events")).json();
  const mine = events.filter(e => e.labeler_id === id).map(e => e.action);
  for (const a of ["labeler invited", "consent", "label submitted", "label reopened", "link turned off", "new link made (the old one stops working)"])
    assert.ok(mine.some(x => x.startsWith(a)), a);
  assert.equal(events.find(e => e.action === "label reopened" && e.labeler_id === id).detail.reason, "typo in the gap");
});

test("the admin API rejects unknown cases and over-long text", async () => {
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "X", cases: ["case_99"] })).status, 400);
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "x".repeat(101), cases: [] })).status, 400);
  assert.equal((await admin("/api/admin/labelers", "POST", { invited_name: "", cases: [] })).status, 400);
});
