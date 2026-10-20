// The online labeling site (labeling-site/README.md; docs/ARCHITECTURE.md, ADR-13).
// Outside labelers open a personal invite link, agree to the terms, may do the training, and label only the cases the
// owner assigned them, in the same viewer and form as eval/labeling/labeling.html. Each label is saved in D1 against the
// labeler, and locks when submitted. The owner manages labelers and exports submitted labels from /admin.
//
// What this Worker never holds: the locked intended answers, the owner's blind labels, Gemini's labels, or any key other
// than ADMIN_KEY. A labeler can read only their own labels. The case content comes from the repository
// (content.generated.js, made by labeling-site/build_content.py).
import { CONTENT } from "./content.generated.js";

const CRIT_KEYS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"];
const STATUSES = new Set(["supported", "unsupported", "undeterminable"]);
const ROUTES = new Set(["approve", "request", "route"]);
const GAP_CRITERIA = new Set(["C1", "C2", "C3", "C4"]);
const COOKIE = "lab_session";
const COOKIE_DAYS = 60;
const MAX_TEXT = { credit_name: 100, role: 150, gap_missing: 500, invited_name: 100, invited_email: 200, note: 300, reason: 300 };

// Every id a label may cite, per case: the same list the labeling page offers.
const CASE_IDS = Object.fromEntries(Object.entries(CONTENT.cases).map(([id, c]) => [id, new Set(idsOf(c.view))]));

function idsOf(v) {
  const out = [v.request.id, v.patient.id];
  v.sections.forEach(s => s.items.forEach(i => out.push(i.id)));
  out.push(v.note.id);
  v.note.paragraphs.forEach(p => out.push(p.id));
  return out;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; " +
                             "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

function html(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extra } });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
}
function fail(status, message) { return json({ error: message }, status); }
function landing(message) { return CONTENT.pages.landing.replace("__MESSAGE__", escapeHtml(message)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const now = () => new Date().toISOString();
function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomId() { return "lb_" + [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}
function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function clip(value, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequest(`${field} must be text`);
  const v = value.trim();
  if (v.length > MAX_TEXT[field]) throw new BadRequest(`${field} is longer than ${MAX_TEXT[field]} characters`);
  return v;
}
class BadRequest extends Error {}

async function logEvent(env, actor, action, { labeler = null, caseId = null, detail = null } = {}) {
  await env.DB.prepare("INSERT INTO events (at, actor, labeler_id, case_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(now(), actor, labeler, caseId, action, detail === null ? null : JSON.stringify(detail)).run();
}

// The labeler behind this request's session cookie, or null. A revoked link signs nobody in.
async function currentLabeler(request, env) {
  const token = cookieValue(request, COOKIE);
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare("SELECT * FROM labelers WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha256(token)).first();
  return row || null;
}

function adminAllowed(request, env) {
  const key = env.ADMIN_KEY || "";
  if (key.length < 24) return false;
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") && sameText(auth.slice(7), key);
}

// Checks a label body against the case: known statuses and routings, cited ids that exist in the case.
function cleanLabel(caseId, body) {
  if (!body || typeof body !== "object") throw new BadRequest("the label must be an object");
  const ok = CASE_IDS[caseId];
  const criteria = {};
  for (const k of CRIT_KEYS) {
    const c = (body.criteria || {})[k] || {};
    const status = c.status || "";
    if (status && !STATUSES.has(status)) throw new BadRequest(`${k}: unknown status`);
    const evidence = Array.isArray(c.evidence) ? c.evidence : [];
    if (evidence.length > 60) throw new BadRequest(`${k}: too many evidence ids`);
    for (const id of evidence) if (typeof id !== "string" || !ok.has(id)) throw new BadRequest(`${k}: ${String(id).slice(0, 60)} is not an id in this case`);
    criteria[k] = { status, evidence: [...new Set(evidence)] };
  }
  const routing = body.routing || "";
  if (routing && !ROUTES.has(routing)) throw new BadRequest("unknown routing");
  let gap_criterion = "", gap_missing = "";
  if (routing === "request") {
    gap_criterion = body.gap_criterion || "";
    if (gap_criterion && !GAP_CRITERIA.has(gap_criterion)) throw new BadRequest("unknown gap criterion");
    gap_missing = clip(body.gap_missing, "gap_missing");
  }
  return { criteria, routing, gap_criterion, gap_missing };
}
function complete(label) {
  if (!label.routing) return false;
  if (CRIT_KEYS.some(k => !label.criteria[k].status)) return false;
  if (label.routing === "request" && (!label.gap_criterion || !label.gap_missing)) return false;
  return true;
}

async function assignedCases(env, labelerId) {
  const { results } = await env.DB.prepare("SELECT case_id FROM assignments WHERE labeler_id = ?").bind(labelerId).all();
  return CONTENT.order.filter(id => results.some(r => r.case_id === id));
}

// ---- Labeler API ----------------------------------------------------------------------------------------------------

async function labelerApi(request, env, path, me) {
  const method = request.method;
  if (path === "/api/me" && method === "GET") {
    const cases = await assignedCases(env, me.id);
    const { results } = await env.DB.prepare("SELECT case_id, updated_at, submitted_at, body FROM labels WHERE labeler_id = ?").bind(me.id).all();
    const byCase = Object.fromEntries(results.map(r => [r.case_id, r]));
    return json({
      labeler: { invited_name: me.invited_name, credit_name: me.credit_name, role: me.role, consent_at: me.consent_at, training_done_at: me.training_done_at },
      assignments: cases.map(id => {
        const r = byCase[id];
        return { case: id, name: CONTENT.cases[id].name, status: r ? (r.submitted_at ? "submitted" : (complete(JSON.parse(r.body)) ? "complete" : "started")) : "not started",
                 updated_at: r ? r.updated_at : null, submitted_at: r ? r.submitted_at : null };
      }),
    });
  }
  if (path === "/api/consent" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const credit = clip(b.credit_name, "credit_name"), role = clip(b.role, "role");
    if (!credit) throw new BadRequest("please enter the name to credit");
    if (b.agree_credit !== true || b.agree_rules !== true) throw new BadRequest("both boxes need to be ticked");
    await env.DB.prepare("UPDATE labelers SET credit_name = ?, role = ?, consent_at = COALESCE(consent_at, ?) WHERE id = ?").bind(credit, role, now(), me.id).run();
    await logEvent(env, me.id, "consent", { labeler: me.id, detail: { credit_name: credit, role } });
    return json({ ok: true });
  }
  if (!me.consent_at) return fail(403, "Please complete the welcome page first.");
  if (path === "/api/training" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const at = b.done === true ? now() : null;
    await env.DB.prepare("UPDATE labelers SET training_done_at = ? WHERE id = ?").bind(at, me.id).run();
    await logEvent(env, me.id, b.done === true ? "training marked done" : "training unmarked", { labeler: me.id });
    return json({ ok: true, training_done_at: at });
  }
  if (path === "/api/cases" && method === "GET") {
    const cases = await assignedCases(env, me.id);
    return json({
      cases: cases.map(id => ({ case: id, name: CONTENT.cases[id].name, view: CONTENT.cases[id].view })),
      policy_head: CONTENT.policy_head, policy_body: CONTENT.policy_body, criteria: CONTENT.criteria, outputs: CONTENT.outputs, legend: CONTENT.legend,
      content_sha: CONTENT.content_sha,
    });
  }
  const m = path.match(/^\/api\/labels\/([a-z0-9_]{1,40})(\/submit)?$/);
  if (m) {
    const caseId = m[1];
    if (!CONTENT.cases[caseId] || !(await assignedCases(env, me.id)).includes(caseId)) return fail(404, "This case is not assigned to you.");
    const row = await env.DB.prepare("SELECT * FROM labels WHERE labeler_id = ? AND case_id = ?").bind(me.id, caseId).first();
    if (!m[2] && method === "GET") {
      return json(row ? { label: JSON.parse(row.body), updated_at: row.updated_at, submitted_at: row.submitted_at } : { label: null });
    }
    if (!m[2] && method === "PUT") {
      if (row && row.submitted_at) return fail(409, "This case is already submitted.");
      const label = cleanLabel(caseId, await request.json().catch(() => null));
      const at = now();
      const r = await env.DB.prepare(
        "INSERT INTO labels (labeler_id, case_id, body, updated_at, content_sha) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (labeler_id, case_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, " +
        "content_sha = excluded.content_sha WHERE labels.submitted_at IS NULL")
        .bind(me.id, caseId, JSON.stringify(label), at, CONTENT.content_sha).run();
      if (!r.meta.changes) return fail(409, "This case is already submitted.");
      if (!row) await logEvent(env, me.id, "label started", { labeler: me.id, caseId });
      return json({ ok: true, updated_at: at, complete: complete(label) });
    }
    if (m[2] && method === "POST") {
      if (!row) return fail(400, "Nothing to submit yet.");
      if (row.submitted_at) return fail(409, "This case is already submitted.");
      const label = JSON.parse(row.body);
      if (!complete(label)) return fail(400, "Every criterion needs a status, the routing needs a choice, and a request needs its gap.");
      const at = now();
      const r = await env.DB.prepare("UPDATE labels SET submitted_at = ? WHERE labeler_id = ? AND case_id = ? AND submitted_at IS NULL")
        .bind(at, me.id, caseId).run();
      if (!r.meta.changes) return fail(409, "This case is already submitted.");
      await logEvent(env, me.id, "label submitted", { labeler: me.id, caseId, detail: { body: label, content_sha: row.content_sha } });
      return json({ ok: true, submitted_at: at });
    }
  }
  return fail(404, "Not found.");
}

// ---- Owner (admin) API ----------------------------------------------------------------------------------------------

function cleanCases(list) {
  if (!Array.isArray(list)) throw new BadRequest("cases must be a list");
  const out = [...new Set(list)];
  for (const id of out) if (!CONTENT.cases[id]) throw new BadRequest(`unknown case ${String(id).slice(0, 40)}`);
  return out;
}

async function adminApi(request, env, path) {
  const method = request.method;
  if (path === "/api/admin/state" && method === "GET") {
    const { results: labelers } = await env.DB.prepare("SELECT * FROM labelers ORDER BY created_at").all();
    const { results: assignments } = await env.DB.prepare("SELECT labeler_id, case_id FROM assignments").all();
    const { results: labels } = await env.DB.prepare("SELECT labeler_id, case_id, updated_at, submitted_at, body FROM labels").all();
    return json({
      content_sha: CONTENT.content_sha,
      cases: CONTENT.order.map(id => ({ case: id, name: CONTENT.cases[id].name, kind: CONTENT.cases[id].kind })),
      labelers: labelers.map(l => ({
        id: l.id, invited_name: l.invited_name, invited_email: l.invited_email, note: l.note, credit_name: l.credit_name, role: l.role,
        consent_at: l.consent_at, training_done_at: l.training_done_at, created_at: l.created_at, revoked_at: l.revoked_at,
        cases: CONTENT.order.filter(id => assignments.some(a => a.labeler_id === l.id && a.case_id === id)).map(id => {
          const r = labels.find(x => x.labeler_id === l.id && x.case_id === id);
          return { case: id, status: r ? (r.submitted_at ? "submitted" : (complete(JSON.parse(r.body)) ? "complete" : "started")) : "not started",
                   updated_at: r ? r.updated_at : null, submitted_at: r ? r.submitted_at : null };
        }),
      })),
    });
  }
  if (path === "/api/admin/labelers" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const name = clip(b.invited_name, "invited_name");
    if (!name) throw new BadRequest("please enter a name");
    const email = clip(b.invited_email, "invited_email"), note = clip(b.note, "note");
    const cases = cleanCases(b.cases || []);
    const id = randomId(), token = randomToken(), at = now();
    const stmts = [env.DB.prepare("INSERT INTO labelers (id, token_hash, invited_name, invited_email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, await sha256(token), name, email || null, note || null, at)];
    for (const c of cases) stmts.push(env.DB.prepare("INSERT INTO assignments (labeler_id, case_id, assigned_at) VALUES (?, ?, ?)").bind(id, c, at));
    await env.DB.batch(stmts);
    await logEvent(env, "owner", "labeler invited", { labeler: id, detail: { invited_name: name, cases } });
    return json({ id, link: new URL("/l/" + token, request.url).toString() });
  }
  if (path === "/api/admin/export" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT l.labeler_id, l.case_id, l.body, l.updated_at, l.submitted_at, l.content_sha, p.credit_name, p.role, p.consent_at, " +
      "p.training_done_at, p.invited_name FROM labels l JOIN labelers p ON p.id = l.labeler_id WHERE l.submitted_at IS NOT NULL " +
      "ORDER BY l.labeler_id, l.case_id").all();
    return json({
      exported_at: now(), content_sha: CONTENT.content_sha,
      note: "Submitted labels only. content_sha on each label is the fingerprint of the case content the labeler saw.",
      labels: results.map(r => ({ labeler_id: r.labeler_id, invited_name: r.invited_name, credit_name: r.credit_name, role: r.role,
        consent_at: r.consent_at, training_done_at: r.training_done_at, case: r.case_id, submitted_at: r.submitted_at,
        updated_at: r.updated_at, content_sha: r.content_sha, label: JSON.parse(r.body) })),
    });
  }
  if (path === "/api/admin/events" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 500").all();
    return json({ events: results.map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) });
  }
  const m = path.match(/^\/api\/admin\/labelers\/(lb_[0-9a-f]{16})\/(cases|link|revoke|reopen)$/);
  if (m && method === "POST") {
    const [, id, what] = m;
    const l = await env.DB.prepare("SELECT * FROM labelers WHERE id = ?").bind(id).first();
    if (!l) return fail(404, "No such labeler.");
    const b = await request.json().catch(() => ({}));
    if (what === "cases") {
      const cases = cleanCases(b.cases || []);
      const { results: has } = await env.DB.prepare("SELECT case_id FROM labels WHERE labeler_id = ?").bind(id).all();
      const keep = has.map(r => r.case_id).filter(c => !cases.includes(c));
      if (keep.length) throw new BadRequest(`these cases already have saved labels and stay assigned: ${keep.join(", ")}`);
      const at = now();
      await env.DB.batch([env.DB.prepare("DELETE FROM assignments WHERE labeler_id = ?").bind(id),
        ...cases.map(c => env.DB.prepare("INSERT INTO assignments (labeler_id, case_id, assigned_at) VALUES (?, ?, ?)").bind(id, c, at))]);
      await logEvent(env, "owner", "cases assigned", { labeler: id, detail: { cases } });
      return json({ ok: true });
    }
    if (what === "link") {
      const token = randomToken();
      await env.DB.prepare("UPDATE labelers SET token_hash = ?, revoked_at = NULL WHERE id = ?").bind(await sha256(token), id).run();
      await logEvent(env, "owner", "new link made (the old one stops working)", { labeler: id });
      return json({ link: new URL("/l/" + token, request.url).toString() });
    }
    if (what === "revoke") {
      await env.DB.prepare("UPDATE labelers SET revoked_at = ? WHERE id = ?").bind(now(), id).run();
      await logEvent(env, "owner", "link turned off", { labeler: id });
      return json({ ok: true });
    }
    if (what === "reopen") {
      const caseId = typeof b.case === "string" ? b.case : "";
      const reason = clip(b.reason, "reason");
      if (!reason) throw new BadRequest("please give a reason; it is kept in the audit trail");
      const r = await env.DB.prepare("UPDATE labels SET submitted_at = NULL WHERE labeler_id = ? AND case_id = ? AND submitted_at IS NOT NULL").bind(id, caseId).run();
      if (!r.meta.changes) return fail(404, "That case is not submitted.");
      await logEvent(env, "owner", "label reopened", { labeler: id, caseId, detail: { reason } });
      return json({ ok: true });
    }
  }
  return fail(404, "Not found.");
}

// ---- Router ---------------------------------------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET" && (path === "/" || path === "")) return html(landing("This site is for invited labelers. Open the personal link you were sent."));
      if (request.method === "GET" && path.startsWith("/l/")) {
        const token = path.slice(3);
        const row = token && token.length <= 100
          ? await env.DB.prepare("SELECT id FROM labelers WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha256(token)).first() : null;
        if (!row) return html(landing("This link isn't valid any more. Ask the person who sent it for a new one."), 404);
        await logEvent(env, row.id, "signed in with link", { labeler: row.id });
        return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, Location: "/app",
          "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}` } });
      }
      if (request.method === "GET" && (path === "/app" || path === "/training")) {
        const me = await currentLabeler(request, env);
        if (!me) return html(landing("Please open the personal link you were sent. If it doesn't work, ask for a new one."), 401);
        return html(path === "/app" ? CONTENT.pages.app : CONTENT.pages.training);
      }
      if (request.method === "GET" && path === "/admin") return html(CONTENT.pages.admin);
      if (path.startsWith("/api/")) {
        // Changes must come from this site's own pages: a cross-site form cannot set this header.
        if (request.method !== "GET" && request.headers.get("X-Labeling") !== "1") return fail(403, "Missing request header.");
        if (path.startsWith("/api/admin/")) {
          if (!adminAllowed(request, env)) return fail(401, "The admin key is missing or wrong.");
          return await adminApi(request, env, path);
        }
        const me = await currentLabeler(request, env);
        if (!me) return fail(401, "Please open your personal link again.");
        return await labelerApi(request, env, path, me);
      }
      return html(landing("Page not found."), 404);
    } catch (e) {
      if (e instanceof BadRequest) return fail(400, e.message);
      console.error(e);
      return fail(500, "Something went wrong on the server.");
    }
  },
};
