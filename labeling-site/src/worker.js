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
const COOKIE = "__Host-lab_session";   // __Host-: only this exact site can set it (no other subdomain), Secure, Path=/
const COOKIE_DAYS = 60;
const MAX_TEXT = { credit_name: 100, role: 150, gap_missing: 500, invited_name: 100, invited_email: 200, note: 300, reason: 300 };

const isCase = id => typeof id === "string" && Object.hasOwn(CONTENT.cases, id);
// Every id a label may cite, per case: the same list the labeling page offers.
const CASE_IDS = Object.fromEntries(Object.entries(CONTENT.cases).map(([id, c]) => [id, new Set(idsOf(c.view))]));

function idsOf(v) {
  const out = [v.request.id, v.patient.id];
  v.sections.forEach(s => s.items.forEach(i => out.push(i.id)));
  out.push(v.note.id);
  v.note.paragraphs.forEach(p => out.push(p.id));
  return out;
}

// Each page's one inline script is allowed by its SHA-256 (made by build_content.py), so no other script can run.
function headers(page) {
  const script = page && CONTENT.script_hashes[page] ? `'${CONTENT.script_hashes[page]}'` : "'none'";
  return {
    "Content-Security-Policy": `default-src 'none'; script-src ${script}; style-src 'unsafe-inline'; connect-src 'self'; ` +
                               "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}
function html(page, body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers(page) } });
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers(null), ...extra } });
}
function fail(status, message, code = null) { return json(code ? { error: message, code } : { error: message }, status); }
// Fills a page's placeholder. A function, not a string, so "$&" or "$`" in a person's name is shown as typed.
const fill = (page, slot, text) => page.replace(slot, () => text);
function landing(message, status = 200) { return html("landing", fill(CONTENT.pages.landing, "__MESSAGE__", escapeHtml(message)), status); }
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

// An audit event, written in the same batch (one transaction) as the change it records. With onlyIfChanged, it is
// written only if the statement just before it in the batch changed a row (SQLite's changes()), so a refused change
// leaves no event claiming it happened.
function event(env, actor, action, { labeler = null, caseId = null, detail = null, onlyIfChanged = false } = {}) {
  return env.DB.prepare("INSERT INTO events (at, actor, labeler_id, case_id, action, detail) SELECT ?, ?, ?, ?, ?, ?" +
                        (onlyIfChanged ? " WHERE changes() > 0" : ""))
    .bind(now(), actor, labeler, caseId, action, detail === null ? null : JSON.stringify(detail));
}

async function labelerByToken(env, token) {
  if (typeof token !== "string" || !token || token.length > 100) return null;
  return (await env.DB.prepare("SELECT * FROM labelers WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha256(token)).first()) || null;
}
// The labeler behind this request's session cookie, or null. A turned-off or replaced link signs nobody in.
async function currentLabeler(request, env) { return labelerByToken(env, cookieValue(request, COOKIE)); }

function adminKey(env) { return (env.ADMIN_KEY || "").trim(); }
function adminAllowed(request, env) {
  const key = adminKey(env);
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") && sameText(auth.slice(7).trim(), key);
}

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
// An answer that may not be chosen yet: missing, null, or "" mean "not chosen"; anything else must be text.
// Badly shaped input is refused, never read as "not chosen", so it can't erase an answer.
function choice(value, field) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new BadRequest(`${field} must be text`);
  return value;
}

// Checks a label body against the case: known statuses and routings, cited ids that exist in the case.
function cleanLabel(caseId, body) {
  if (!isObject(body)) throw new BadRequest("the label must be an object");
  if (body.criteria !== undefined && !isObject(body.criteria)) throw new BadRequest("criteria must be an object");
  const ok = CASE_IDS[caseId];
  const criteria = {};
  for (const k of CRIT_KEYS) {
    const c = body.criteria && Object.hasOwn(body.criteria, k) ? body.criteria[k] : {};
    if (!isObject(c)) throw new BadRequest(`${k} must be an object with a status and evidence`);
    const status = choice(c.status, `${k}: status`);
    if (status && !STATUSES.has(status)) throw new BadRequest(`${k}: unknown status`);
    if (c.evidence !== undefined && !Array.isArray(c.evidence)) throw new BadRequest(`${k}: evidence must be a list`);
    const evidence = c.evidence || [];
    if (evidence.length > 60) throw new BadRequest(`${k}: too many evidence ids`);
    for (const id of evidence) if (typeof id !== "string" || !ok.has(id)) throw new BadRequest(`${k}: ${String(id).slice(0, 60)} is not an id in this case`);
    criteria[k] = { status, evidence: [...new Set(evidence)] };
  }
  const routing = choice(body.routing, "routing");
  if (routing && !ROUTES.has(routing)) throw new BadRequest("unknown routing");
  let gap_criterion = "", gap_missing = "";
  if (routing === "request") {
    gap_criterion = choice(body.gap_criterion, "gap_criterion");
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
function statusOf(row) {
  return row ? (row.submitted_at ? "submitted" : (complete(JSON.parse(row.body)) ? "complete" : "started")) : "not started";
}

async function assignedCases(env, labelerId) {
  const { results } = await env.DB.prepare("SELECT case_id FROM assignments WHERE labeler_id = ?").bind(labelerId).all();
  return CONTENT.order.filter(id => results.some(r => r.case_id === id));
}

// ---- Signing in with a personal link --------------------------------------------------------------------------------
// GET /l/<token> only shows a "Continue" page and changes nothing, so link scanners and other sites can't sign anyone
// in or out. The page's button sends the token to POST /api/session, which sets the cookie and records the sign-in.

async function linkPage(request, env, token) {
  const who = await labelerByToken(env, token);
  if (!who) return landing("This link isn't valid any more. Ask the person who sent it for a new one.", 404);
  const current = await currentLabeler(request, env);
  const switching = current && current.id !== who.id
    ? `This browser is signed in as ${escapeHtml(current.credit_name || current.invited_name)}. Continuing switches it to ${escapeHtml(who.invited_name)}.` : "";
  return html("continue", fill(fill(CONTENT.pages.continue, "__FOR__", escapeHtml(who.invited_name)), "__SWITCH__", switching));
}

async function startSession(request, env) {
  const b = await request.json().catch(() => ({}));
  const who = await labelerByToken(env, b.token);
  if (!who) return fail(404, "This link isn't valid any more. Ask the person who sent it for a new one.");
  await env.DB.batch([event(env, who.id, "signed in with link", { labeler: who.id })]);
  return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=${b.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}` });
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
        return { case: id, name: CONTENT.cases[id].name, status: statusOf(r), updated_at: r ? r.updated_at : null, submitted_at: r ? r.submitted_at : null };
      }),
    });
  }
  if (path === "/api/consent" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const credit = clip(b.credit_name, "credit_name"), role = clip(b.role, "role");
    if (!credit) throw new BadRequest("please enter the name to credit");
    if (b.agree_credit !== true || b.agree_rules !== true) throw new BadRequest("both boxes need to be ticked");
    await env.DB.batch([
      env.DB.prepare("UPDATE labelers SET credit_name = ?, role = ?, consent_at = COALESCE(consent_at, ?) WHERE id = ?").bind(credit, role, now(), me.id),
      event(env, me.id, "consent", { labeler: me.id, detail: { credit_name: credit, role } }),
    ]);
    return json({ ok: true });
  }
  if (!me.consent_at) return fail(403, "Please complete the welcome page first.");
  if (path === "/api/training" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (typeof b.done !== "boolean") throw new BadRequest("done must be true or false");
    const at = b.done ? now() : null;
    await env.DB.batch([
      env.DB.prepare("UPDATE labelers SET training_done_at = ? WHERE id = ?").bind(at, me.id),
      event(env, me.id, b.done ? "training marked done" : "training unmarked", { labeler: me.id }),
    ]);
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
    if (!isCase(caseId) || !(await assignedCases(env, me.id)).includes(caseId)) return fail(404, "This case is not assigned to you.");
    const row = await env.DB.prepare("SELECT * FROM labels WHERE labeler_id = ? AND case_id = ?").bind(me.id, caseId).first();
    if (!m[2] && method === "GET") {
      return json(row ? { label: JSON.parse(row.body), rev: row.rev, updated_at: row.updated_at, submitted_at: row.submitted_at } : { label: null, rev: 0 });
    }
    if (method !== (m[2] ? "POST" : "PUT")) return fail(404, "Not found.");
    // A save or a submit carries the label as the page shows it, the revision it was based on, and the content
    // fingerprint the page loaded, so nothing is saved over a newer copy or against content that has since changed.
    const b = await request.json().catch(() => null);
    if (!isObject(b)) throw new BadRequest("the request must be an object");
    if (b.content_sha !== CONTENT.content_sha) return fail(409, "The cases were updated since this page was opened. Reload the page; your saved answers are kept.", "content_changed");
    if (row && row.submitted_at) return fail(409, "This case is already submitted.", "submitted");
    const rev = Number.isInteger(b.rev) ? b.rev : -1;
    if ((row ? row.rev : 0) !== rev) return fail(409, "This case was changed in another tab or on another device.", "stale");
    const label = cleanLabel(caseId, b.label);
    const at = now(), submit = !!m[2];
    if (submit && !complete(label)) return fail(400, "Every criterion needs a status, the routing needs a choice, and a request needs its gap.");
    const caseSha = CONTENT.cases[caseId].case_sha;
    const write = row
      ? env.DB.prepare("UPDATE labels SET body = ?, rev = rev + 1, updated_at = ?, submitted_at = ?, content_sha = ?, case_sha = ? " +
                       "WHERE labeler_id = ? AND case_id = ? AND rev = ? AND submitted_at IS NULL")
          .bind(JSON.stringify(label), at, submit ? at : null, CONTENT.content_sha, caseSha, me.id, caseId, rev)
      : env.DB.prepare("INSERT INTO labels (labeler_id, case_id, body, rev, updated_at, submitted_at, content_sha, case_sha) " +
                       "VALUES (?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (labeler_id, case_id) DO NOTHING")
          .bind(me.id, caseId, JSON.stringify(label), at, submit ? at : null, CONTENT.content_sha, caseSha);
    const stmts = [write];
    if (submit) stmts.push(event(env, me.id, "label submitted", { labeler: me.id, caseId, onlyIfChanged: true, detail: { body: label, content_sha: CONTENT.content_sha, case_sha: caseSha } }));
    else if (!row) stmts.push(event(env, me.id, "label started", { labeler: me.id, caseId, onlyIfChanged: true }));
    const results = await env.DB.batch(stmts);
    // Another save got in first (between the read above and this write): nothing was written.
    if (!results[0].meta.changes) return fail(409, "This case was changed in another tab or on another device.", "stale");
    return json({ ok: true, rev: rev + 1, updated_at: at, submitted_at: submit ? at : null, complete: complete(label), label });
  }
  return fail(404, "Not found.");
}

// ---- Owner (admin) API ----------------------------------------------------------------------------------------------

function cleanCases(list) {
  if (!Array.isArray(list)) throw new BadRequest("cases must be a list");
  const out = [...new Set(list)];
  for (const id of out) if (!isCase(id)) throw new BadRequest(`unknown case ${String(id).slice(0, 40)}`);
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
          return { case: id, status: statusOf(r), updated_at: r ? r.updated_at : null, submitted_at: r ? r.submitted_at : null };
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
    await env.DB.batch([
      env.DB.prepare("INSERT INTO labelers (id, token_hash, invited_name, invited_email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, await sha256(token), name, email || null, note || null, at),
      ...cases.map(c => env.DB.prepare("INSERT INTO assignments (labeler_id, case_id, assigned_at) VALUES (?, ?, ?)").bind(id, c, at)),
      event(env, "owner", "labeler invited", { labeler: id, detail: { invited_name: name, cases } }),
    ]);
    return json({ id, link: new URL("/l/" + token, request.url).toString() });
  }
  if (path === "/api/admin/export" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT l.labeler_id, l.case_id, l.body, l.rev, l.updated_at, l.submitted_at, l.content_sha, l.case_sha, p.credit_name, p.role, " +
      "p.consent_at, p.training_done_at, p.invited_name FROM labels l JOIN labelers p ON p.id = l.labeler_id WHERE l.submitted_at IS NOT NULL " +
      "ORDER BY l.labeler_id, l.case_id").all();
    return json({
      exported_at: now(), content_sha: CONTENT.content_sha,
      note: "Submitted labels only. case_sha is the fingerprint of the case record the labeler's page showed; content_sha, of all the site's case content then. kind is golden or practice.",
      labels: results.map(r => ({ labeler_id: r.labeler_id, invited_name: r.invited_name, credit_name: r.credit_name, role: r.role,
        consent_at: r.consent_at, training_done_at: r.training_done_at, case: r.case_id, kind: isCase(r.case_id) ? CONTENT.cases[r.case_id].kind : "unknown",
        submitted_at: r.submitted_at, updated_at: r.updated_at, revision: r.rev, case_sha: r.case_sha, content_sha: r.content_sha, label: JSON.parse(r.body) })),
    });
  }
  if (path === "/api/admin/events" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 500").all();
    return json({ events: results.map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) });
  }
  const m = path.match(/^\/api\/admin\/labelers\/(lb_[0-9a-f]{16})\/(cases|link|revoke|reopen|remove)$/);
  if (m && method === "POST") {
    const [, id, what] = m;
    const l = await env.DB.prepare("SELECT * FROM labelers WHERE id = ?").bind(id).first();
    if (!l) return fail(404, "No such labeler.");
    const b = await request.json().catch(() => ({}));
    if (what === "cases") {
      const cases = cleanCases(b.cases);   // required: a missing list must not clear someone's cases
      const { results: has } = await env.DB.prepare("SELECT case_id FROM labels WHERE labeler_id = ?").bind(id).all();
      const keep = has.map(r => r.case_id).filter(c => !cases.includes(c));
      if (keep.length) throw new BadRequest(`these cases already have saved labels and stay assigned: ${keep.map(c => CONTENT.cases[c].name).join(", ")}`);
      const at = now();
      await env.DB.batch([env.DB.prepare("DELETE FROM assignments WHERE labeler_id = ?").bind(id),
        ...cases.map(c => env.DB.prepare("INSERT INTO assignments (labeler_id, case_id, assigned_at) VALUES (?, ?, ?)").bind(id, c, at)),
        event(env, "owner", "cases assigned", { labeler: id, detail: { cases } })]);
      return json({ ok: true });
    }
    if (what === "link") {
      const token = randomToken();
      await env.DB.batch([env.DB.prepare("UPDATE labelers SET token_hash = ?, revoked_at = NULL WHERE id = ?").bind(await sha256(token), id),
        event(env, "owner", "new link made (the old one stops working)", { labeler: id })]);
      return json({ link: new URL("/l/" + token, request.url).toString() });
    }
    if (what === "revoke") {
      await env.DB.batch([env.DB.prepare("UPDATE labelers SET revoked_at = ? WHERE id = ?").bind(now(), id),
        event(env, "owner", "link turned off", { labeler: id })]);
      return json({ ok: true });
    }
    if (what === "reopen") {
      const caseId = isCase(b.case) ? b.case : "";
      const reason = clip(b.reason, "reason");
      if (!reason) throw new BadRequest("please give a reason; it is kept in the activity log");
      const r = await env.DB.batch([
        env.DB.prepare("UPDATE labels SET submitted_at = NULL, rev = rev + 1 WHERE labeler_id = ? AND case_id = ? AND submitted_at IS NOT NULL").bind(id, caseId),
        event(env, "owner", "label reopened", { labeler: id, caseId, onlyIfChanged: true, detail: { reason } })]);
      if (!r[0].meta.changes) return fail(404, "That case is not submitted.");
      return json({ ok: true });
    }
    if (what === "remove") {
      // On a person's request: their labels, assignments, and details go; the audit trail keeps what happened and when,
      // with the details of their events cleared, and records the removal.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM labels WHERE labeler_id = ?").bind(id),
        env.DB.prepare("DELETE FROM assignments WHERE labeler_id = ?").bind(id),
        env.DB.prepare("DELETE FROM labelers WHERE id = ?").bind(id),
        env.DB.prepare("UPDATE events SET detail = NULL WHERE labeler_id = ? AND detail IS NOT NULL").bind(id),
        event(env, "owner", "details removed on request", { labeler: id }),
      ]);
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
      if (request.method === "GET" && (path === "/" || path === "")) return landing("This site is for invited labelers. Open the personal link you were sent.");
      if (request.method === "GET" && path.startsWith("/l/")) return await linkPage(request, env, path.slice(3));
      if (request.method === "GET" && (path === "/app" || path === "/training")) {
        const me = await currentLabeler(request, env);
        if (!me) return landing("Please open the personal link you were sent. If it doesn't work, ask for a new one.", 401);
        return path === "/app" ? html("app", CONTENT.pages.app) : html("training", CONTENT.pages.training);
      }
      if (request.method === "GET" && path === "/admin") return html("admin", CONTENT.pages.admin);
      if (path.startsWith("/api/")) {
        // Changes must come from this site's own pages: another site cannot send this header without permission.
        if (request.method !== "GET" && request.headers.get("X-Labeling") !== "1") return fail(403, "Missing request header.");
        if (path === "/api/session" && request.method === "POST") return await startSession(request, env);
        if (path.startsWith("/api/admin/")) {
          if (adminKey(env).length < 24) return fail(503, "The site has no admin key set. Run the Deploy labeling site workflow again.", "no_admin_key");
          if (!adminAllowed(request, env)) return fail(401, "The admin key is wrong.");
          return await adminApi(request, env, path);
        }
        const me = await currentLabeler(request, env);
        if (!me) return fail(401, "Please open your personal link again.");
        return await labelerApi(request, env, path, me);
      }
      return landing("Page not found.", 404);
    } catch (e) {
      if (e instanceof BadRequest) return fail(400, e.message);
      console.error(e);
      return fail(500, "Something went wrong on the server.");
    }
  },
};
