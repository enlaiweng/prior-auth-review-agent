// The prior authorization review agent: one module, used by the evaluation runs (Node.js on GitHub Actions) and by the
// Cloudflare Worker (docs/ARCHITECTURE.md, ADR-10 (3)). It reads one FHIR bundle, asks the model for a per-criterion
// report in a fixed JSON schema, checks the report, and lets the fixed rule in agent/routing.js choose the outcome.
// No Node-only modules, so the same file runs in a Worker. No case-specific logic anywhere in this folder.

import { SYSTEM_PROMPT, SCHEMA, PASSAGE_IDS, SPEC_SHA256 } from "./spec.generated.js";
import { readCase, caseMessage } from "./record.js";
import { decideRouting, CRITERIA } from "./routing.js";

export const AGENT_VERSION = "agent-0.2";

// Pinned settings (ADR-10 (4)). Recorded with every run; fixed at the freeze. temperature is not sent: on these
// models a non-default value returns an error. No tools and no tool_choice: the report comes back through the
// API's JSON schema output format.
export const SETTINGS = Object.freeze({
  model: "claude-sonnet-5",
  effort: "high",
  thinking: Object.freeze({ type: "adaptive" }),
  max_tokens: 16000,
});

const API_URL = "https://api.anthropic.com/v1/messages";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 5;
const CALL_TIMEOUT_MS = 280000; // one call; a slower one is abandoned and tried again
const STATUSES = new Set(["supported", "unsupported", "undeterminable"]);
const SHORTS = new Set(["C1", "C2", "C3", "C4"]);

export function requestBody(message, settings = SETTINGS) {
  return {
    model: settings.model,
    max_tokens: settings.max_tokens,
    thinking: { ...settings.thinking },
    output_config: { effort: settings.effort, format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: message }],
  };
}

// Check the report's shape in code as well, so nothing malformed reaches the rule. Returns a list of problems.
export function reportProblems(r) {
  const p = [];
  const isStrList = x => Array.isArray(x) && x.every(s => typeof s === "string");
  if (!r || typeof r !== "object") return ["the report is not an object"];
  if (!r.criteria || typeof r.criteria !== "object") p.push("criteria missing");
  else for (const k of Object.values(CRITERIA)) {
    const c = r.criteria[k];
    if (!c || typeof c !== "object") { p.push(`${k} missing`); continue; }
    if (!STATUSES.has(c.status)) p.push(`${k} status invalid`);
    if (!isStrList(c.evidence)) p.push(`${k} evidence invalid`);
    if (!isStrList(c.policy_passages)) p.push(`${k} policy_passages invalid`);
    if (typeof c.policy_quote !== "string") p.push(`${k} policy_quote invalid`);
    if (typeof c.explanation !== "string") p.push(`${k} explanation invalid`);
  }
  if (!Array.isArray(r.contradictions) || !r.contradictions.every(x => x && SHORTS.has(x.criterion) && isStrList(x.evidence)))
    p.push("contradictions invalid");
  const md = r.missing_document;
  if (!(md === null || (md && SHORTS.has(md.criterion) && typeof md.missing === "string"))) p.push("missing_document invalid");
  return p;
}

async function callModel(body, { apiKey, fetchImpl, apiUrl, sleep }) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetchImpl(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      last = { status: 0, error: String(e) };
      if (attempt < MAX_ATTEMPTS) { await sleep(Math.min(5000 * 2 ** (attempt - 1), 60000)); continue; }
      return { ...last, attempts: attempt };
    }
    let text;
    try { text = await res.text(); } catch (e) {
      // The reply stopped arriving (for example the call's timeout fired while it was being read): try again.
      last = { status: 0, error: String(e) };
      if (attempt < MAX_ATTEMPTS) { await sleep(Math.min(5000 * 2 ** (attempt - 1), 60000)); continue; }
      return { ...last, attempts: attempt };
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.ok) return { status: res.status, json, requestId: res.headers.get("request-id"), attempts: attempt };
    last = { status: res.status, error: json?.error?.message || text.slice(0, 300), requestId: res.headers.get("request-id") };
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60000) : Math.min(5000 * 2 ** (attempt - 1), 60000));
      continue;
    }
    return { ...last, attempts: attempt };
  }
  return { ...last, attempts: MAX_ATTEMPTS };
}

// Review one case. Never throws for a model or network problem: the decision then routes, with the error recorded,
// because routing is the safe outcome. Throws only for a bundle it cannot read or a missing key.
export async function reviewCase(bundle, {
  apiKey, caseId = null, approveEnabled = true, settings = SETTINGS,
  fetchImpl = globalThis.fetch, apiUrl = API_URL, sleep = ms => new Promise(r => setTimeout(r, ms)),
} = {}) {
  if (!apiKey) throw new Error("no API key given");
  const rc = readCase(bundle);
  const body = requestBody(caseMessage(rc), settings);
  const started = Date.now();
  const call = await callModel(body, { apiKey, fetchImpl, apiUrl, sleep });
  const decision = {
    case_id: caseId,
    agent_version: AGENT_VERSION,
    spec_sha256: SPEC_SHA256,
    request: rc.claimId,
    routing: "route",
    named_gap: null,
    basis: null,
    routing_reasons: [],
    checklist_mode: approveEnabled === false,
    criteria: null,
    contradictions: null,
    missing_document_suggested: null,
    invalid_evidence: [],
    invalid_policy_passages: [],
    case_summary: null,
    confidence: null,
    error: null,
    model: { requested: settings.model, returned: call.json?.model ?? null, effort: settings.effort,
             thinking: settings.thinking, max_tokens: settings.max_tokens },
    stop_reason: call.json?.stop_reason ?? null,
    usage: call.json?.usage ?? null,
    request_id: call.requestId ?? null,
    attempts: call.attempts,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  const fail = msg => {
    decision.error = msg;
    decision.routing_reasons = [`The model's report could not be used (${msg}), so the case is routed.`];
    return decision;
  };
  if (call.status !== 200) return fail(`API returned HTTP ${call.status}: ${call.error}`);
  if (!call.json || typeof call.json !== "object") return fail("the API's reply was not JSON");
  if (call.json.stop_reason !== "end_turn") return fail(`the reply stopped early (stop_reason ${call.json.stop_reason})`);
  const textBlock = (call.json.content || []).find(b => b.type === "text");
  if (!textBlock) return fail("the reply has no text block");
  let report;
  try { report = JSON.parse(textBlock.text); } catch (e) { return fail("the reply is not valid JSON"); }
  const problems = reportProblems(report);
  if (problems.length) return fail("the report does not match the schema: " + problems.join("; "));

  const verdict = decideRouting(report, {
    validIds: new Set(rc.citableIds), noteIds: rc.noteIds, passageIds: new Set(PASSAGE_IDS), approveEnabled,
    entryStart: rc.entryStart, requestDate: rc.requestDate,
  });
  return Object.assign(decision, {
    routing: verdict.routing,
    named_gap: verdict.named_gap,
    basis: verdict.basis,
    routing_reasons: verdict.reasons,
    criteria: report.criteria,
    contradictions: report.contradictions,
    missing_document_suggested: report.missing_document,
    invalid_evidence: verdict.invalid_evidence,
    invalid_policy_passages: verdict.invalid_policy_passages,
    case_summary: report.case_summary,
    confidence: report.confidence,
  });
}
