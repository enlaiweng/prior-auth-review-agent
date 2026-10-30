// The public demo of the prior authorization review agent (docs/ARCHITECTURE.md, ADR-7, ADR-9 and ADR-14).
//
// One Cloudflare Worker serves a one-page viewer of the twelve synthetic golden cases:
//   - Anyone can read each case's record and its stored decision, if a stored run is set (demo/stored_run.txt).
//     A stored decision's outcome is decided again here by the agent's fixed rule, under the current mode.
//   - Live runs call the real agent (agent/agent.js, unchanged) on one case, with the demo's own key. They need the
//     passcode the owner hands out, are capped per minute and per day, and are refused for the held-out cases, for
//     any case whose final labels are not yet in place, for cases an outside clinician is still reading, and, until
//     run 1, for every case outside the development set (demo/live_scope.json).
//   - Checklist mode (the kill switch, RUNBOOK.md): the approve output and document requests are off unless the
//     Worker's CHECKLIST_MODE setting is exactly "false". Missing, empty, or anything else means checklist mode.
// The Worker holds no labels, no intended answers, and no case-specific logic. It keeps no request logs; it stores one
// row per live-run attempt (time, case, outcome) for the caps and, on wrong-passcode rows only, a daily keyed
// fingerprint of the visitor's address (migrations/0002_visitor.sql). No address or passcode is stored.

import { CONTENT } from "./content.generated.js";
import { reviewCase, AGENT_VERSION, SETTINGS } from "../../agent/agent.js";
import { SPEC_SHA256 } from "../../agent/spec.generated.js";
import { redecide } from "./decide.js";
import { localTestUrl } from "./testhook.js";
import { network } from "./network.js";

const HEARTBEAT_MS = 10000;          // a progress line every ten seconds keeps the connection open while the model works
const BAD_PASSCODE_WINDOW_MS = 600000;
const BAD_PER_VISITOR = 5;           // wrong passcodes in ten minutes before live runs pause for that visitor
const BAD_OVERALL = 50;              // wrong passcodes in ten minutes, all visitors together, before live runs pause for all
const MIN_PASSCODE = 12;

if (CONTENT.agent.version !== AGENT_VERSION || CONTENT.agent.spec_sha256 !== SPEC_SHA256) {
  throw new Error("demo content was built for a different agent; run python3 demo/build_demo.py");
}

// ---- Settings ---------------------------------------------------------------------------------------------------
// Fail-safe: approvals and document requests are on only when CHECKLIST_MODE is exactly "false".
const approveOn = env => env.CHECKLIST_MODE === "false";
const passcode = env => (typeof env.DEMO_PASSCODE === "string" ? env.DEMO_PASSCODE.trim() : "");
const apiKey = env => (typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "");
const limit = (v, fallback) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : fallback; };
const perMinute = env => limit(env.LIVE_PER_MINUTE, 2);
const perDay = env => limit(env.LIVE_PER_DAY, 20);
// One live run gives up after this many seconds (default four minutes) and routes, with the error shown.
const deadlineMs = env => Math.min(limit(env.LIVE_DEADLINE_SECONDS, 240), 600) * 1000;
function liveProblem(env) {
  if (!apiKey(env)) return "Live runs aren't set up: the demo has no model key.";
  if (passcode(env).length < MIN_PASSCODE) return "Live runs aren't set up: the demo has no passcode.";
  if (String(env.VISITOR_KEY || "").length < 32) return "Live runs aren't set up: the demo has no visitor key.";
  return null;
}
// Tests only: send the model call to a fake server on this computer (testhook.js says which addresses count).
function testApi(env) {
  const u = localTestUrl(env.AGENT_TEST_API_URL);
  return u ? { apiUrl: u } : {};
}

// ---- Responses --------------------------------------------------------------------------------------------------
function headers(isPage) {
  const script = isPage ? `'${CONTENT.page_script_hash}'` : "'none'";
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
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers(false) } });
const fail = (status, message, code) => json({ error: message, code }, status);

async function digest(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
// Compares fingerprints of equal length, so the time taken says nothing about the passcode.
async function samePasscode(given, expected) {
  return crypto.subtle.timingSafeEqual(await digest(given), await digest(expected));
}

// ---- Cases ------------------------------------------------------------------------------------------------------
// Why a case doesn't run live, in the order the build checks (demo/build_demo.py, refusal).
const REFUSALS = {
  held_out: "This is one of the three held-out cases. They are never run before the release evaluation, so the agent can't be tuned on them.",
  unlabeled: "This case's final answer key isn't settled yet, so it doesn't run live until it is.",
  outside_reader: "An outside clinician is reading this case right now. The agent's answer on it stays hidden until their answers are in, so nothing here can shape their reading.",
  before_run1: "Until the first full run (run 1), live runs are limited to the development cases, 01 to 05, so run 1 stays the first look at the other cases.",
};
const liveRefusal = c => (c.refusal ? REFUSALS[c.refusal] || "This case doesn't run live." : null);
function storedFor(caseId, env) {
  const c = CONTENT.cases[caseId];
  // A backstop for the build's rule: never a stored decision for a held-out case or one an outside clinician is reading.
  if (c.held_out || c.refusal === "outside_reader") return null;
  try {
    return redecide(c.bundle, CONTENT.stored[caseId], approveOn(env));
  } catch (e) {
    // A stored report the rule can't read is shown as a failed decision, routed, rather than breaking the page.
    return redecide(c.bundle, { error: "the stored report could not be read (" + String(e && e.message || e) + ")" }, approveOn(env));
  }
}
function caseSummary(caseId, env) {
  const c = CONTENT.cases[caseId];
  const s = storedFor(caseId, env);
  return { case: caseId, name: c.name, request: c.view.request.text, patient: c.view.patient.text, held_out: c.held_out,
           refusal: c.refusal, live_refusal: liveRefusal(c), stored: s ? { routing: s.routing, error: !!s.error } : null };
}

async function status(env) {
  const day = await runsSince(env, startOfDay(Date.now()));
  return {
    agent: { version: AGENT_VERSION, spec_sha256: SPEC_SHA256, model: SETTINGS.model, effort: SETTINGS.effort },
    mode: approveOn(env) ? "approve" : "checklist",
    live: { problem: liveProblem(env), per_minute: perMinute(env), per_day: perDay(env), used_today: day },
    stored_run: CONTENT.stored_run, held_out: CONTENT.held_out, live_scope: CONTENT.live_scope, content_sha256: CONTENT.content_sha256,
  };
}

// ---- Live runs --------------------------------------------------------------------------------------------------
const startOfDay = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
async function runsSince(env, sinceMs) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM live_runs WHERE outcome != 'bad_passcode' AND at_ms >= ?1").bind(sinceMs).first();
  return r ? r.n : 0;
}

// A keyed fingerprint of the visitor's network and the day: lets wrong passcodes be limited per visitor without storing
// any address. Cloudflare sets CF-Connecting-IP; a visitor can't choose it. The key is VISITOR_KEY, a random value each
// deploy makes and nobody sees, so a fingerprint can't be turned back into an address.
async function visitor(request, env, now) {
  const ip = network(request.headers.get("CF-Connecting-IP") || "unknown");
  const day = new Date(now).toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.VISITOR_KEY)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip + "|" + day)));
  return [...mac.slice(0, 12)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function liveRun(request, env, ctx, caseId) {
  const c = CONTENT.cases[caseId];
  if (!c) return fail(404, "There is no such case.", "no_case");
  const refusal = liveRefusal(c);
  if (refusal) return fail(409, refusal, "not_live");
  const problem = liveProblem(env);
  if (problem) return fail(503, problem, "live_off");
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return fail(415, "Send the passcode as JSON.", "bad_request");
  let body;
  try { body = await request.json(); } catch { return fail(400, "Send the passcode as JSON.", "bad_request"); }
  if (!body || typeof body !== "object" || typeof body.passcode !== "string" || body.passcode.length > 200)
    return fail(400, "Send the passcode as JSON.", "bad_request");

  const now = Date.now();
  await env.DB.prepare("DELETE FROM live_runs WHERE at_ms < ?1").bind(now - 3 * 86400000).run();
  // Every passcode check first records itself as a wrong passcode, in one statement that also enforces the limits, so
  // many guesses sent at once can't all slip under them. A right passcode then removes its row.
  const who = await visitor(request, env, now);
  const since = now - BAD_PASSCODE_WINDOW_MS;
  const guard = await env.DB.prepare(
    "INSERT INTO live_runs (at_ms, case_id, outcome, who) SELECT ?1, ?2, 'bad_passcode', ?3 " +
    "WHERE (SELECT COUNT(*) FROM live_runs WHERE outcome = 'bad_passcode' AND who = ?3 AND at_ms > ?4) < ?5 " +
    "AND (SELECT COUNT(*) FROM live_runs WHERE outcome = 'bad_passcode' AND at_ms > ?4) < ?6")
    .bind(now, caseId, who, since, BAD_PER_VISITOR, BAD_OVERALL).run();
  if (guard.meta.changes !== 1) return fail(429, "Too many wrong passcodes. Live runs are paused for a few minutes.", "locked");
  if (!(await samePasscode(body.passcode, passcode(env)))) return fail(403, "That passcode isn't right.", "bad_passcode");
  await env.DB.prepare("DELETE FROM live_runs WHERE id = ?1").bind(guard.meta.last_row_id).run();
  // One statement counts and records, so two requests at once can't both slip under a cap.
  const ins = await env.DB.prepare(
    "INSERT INTO live_runs (at_ms, case_id, outcome) SELECT ?1, ?2, 'started' " +
    "WHERE (SELECT COUNT(*) FROM live_runs WHERE outcome != 'bad_passcode' AND at_ms > ?1 - 60000) < ?3 " +
    "AND (SELECT COUNT(*) FROM live_runs WHERE outcome != 'bad_passcode' AND at_ms >= ?4) < ?5")
    .bind(now, caseId, perMinute(env), startOfDay(now), perDay(env)).run();
  if (ins.meta.changes !== 1) {
    const minute = await env.DB.prepare("SELECT COUNT(*) AS n FROM live_runs WHERE outcome != 'bad_passcode' AND at_ms > ?1").bind(now - 60000).first();
    return minute.n >= perMinute(env)
      ? fail(429, `Live runs are limited to ${perMinute(env)} a minute. Try again in a minute.`, "per_minute")
      : fail(429, `Today's ${perDay(env)} live runs are used up. The stored decisions are still here; live runs come back at midnight UTC.`, "per_day");
  }
  const rowId = ins.meta.last_row_id;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = o => writer.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
  const approve = approveOn(env);
  const work = (async () => {
    const started = Date.now();
    const deadline = started + deadlineMs(env);
    send({ type: "started", case: caseId, mode: approve ? "approve" : "checklist" });
    const beat = setInterval(() => send({ type: "waiting", seconds: Math.round((Date.now() - started) / 1000) }), HEARTBEAT_MS);
    let outcome = "error";
    try {
      // The agent retries a failed call up to five times. Past the demo's deadline every retry fails at once, so the
      // run ends with the error recorded and the case routed, the agent's own safe outcome.
      const fetchImpl = (url, init) => {
        const left = deadline - Date.now();
        if (left <= 0) return Promise.reject(new Error("the demo's time limit for one live run passed"));
        return fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(left, 280000)) });
      };
      const sleep = ms => (Date.now() + ms >= deadline ? Promise.resolve() : new Promise(r => setTimeout(r, ms)));
      const d = await reviewCase(c.bundle, { apiKey: apiKey(env), caseId, approveEnabled: approve, fetchImpl, sleep, ...testApi(env) });
      outcome = d.error ? "error" : "done";
      await send({ type: "decision", decision: d });
    } catch (e) {
      await send({ type: "error", message: "The live run stopped: " + String(e && e.message || e) });
    } finally {
      clearInterval(beat);
      try { await env.DB.prepare("UPDATE live_runs SET outcome = ?1 WHERE id = ?2").bind(outcome, rowId).run(); } catch {}
      try { await writer.close(); } catch {}
    }
  })();
  ctx.waitUntil(work);
  return new Response(readable, {
    status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", ...headers(false) },
  });
}

// ---- Routing ----------------------------------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET" && (path === "/" || path === "/index.html"))
        return new Response(CONTENT.page, { headers: { "Content-Type": "text/html; charset=utf-8", ...headers(true) } });
      if (path.startsWith("/api/")) {
        if (request.method === "GET" && path === "/api/status") return json(await status(env));
        if (request.method === "GET" && path === "/api/cases") return json({ cases: CONTENT.order.map(id => caseSummary(id, env)) });
        let m = path.match(/^\/api\/cases\/(case_\d\d)$/);
        if (request.method === "GET" && m) {
          const id = m[1];
          if (!CONTENT.cases[id]) return fail(404, "There is no such case.", "no_case");
          return json({ ...caseSummary(id, env), view: CONTENT.cases[id].view, decision: storedFor(id, env) });
        }
        m = path.match(/^\/api\/run\/(case_\d\d)$/);
        if (m && request.method === "POST") {
          // Live runs must come from the viewer: another site cannot send this header without permission.
          if (request.headers.get("X-Demo") !== "1") return fail(403, "Missing request header.", "bad_request");
          return await liveRun(request, env, ctx, m[1]);
        }
        if (m || path === "/api/status" || path === "/api/cases" || /^\/api\/cases\/case_\d\d$/.test(path))
          return fail(405, "That method isn't allowed here.", "method");
        return fail(404, "Not found.", "not_found");
      }
      return new Response("Not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers(false) } });
    } catch (e) {
      return fail(500, "Something went wrong on the demo's side.", "server");
    }
  },
};
