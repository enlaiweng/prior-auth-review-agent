// Tests of the agent module (agent/agent.js) with a fake model, so nothing is sent to Anthropic.
// Run from the repository root: node --test 'agent/test/*.test.js'
// The fake model's report is a made-up test value for the smoke case; it is not a label for any golden case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { reviewCase, requestBody, SETTINGS, AGENT_VERSION } from "../agent.js";
import { SPEC_SHA256, SCHEMA, SYSTEM_PROMPT } from "../spec.generated.js";

const smoke = JSON.parse(readFileSync("data/smoke/case_00/bundle.json", "utf8"));
const crit = (status, evidence, passages) => ({ explanation: "e", evidence, policy_passages: passages, policy_quote: "q", status });
const smokeReport = {
  criteria: {
    C1_red_flag: crit("unsupported", [], ["L34220-17"]),
    C2_conservative_4wk: crit("supported", ["Procedure/case00-pt-01", "MedicationRequest/case00-med-01"], ["L34220-36"]),
    C3_informs_management: crit("undeterminable", [], ["L34220-39"]),
    C4_no_duplicate_imaging: crit("supported", [], ["L34220-41"]),
  },
  contradictions: [],
  missing_document: { criterion: "C3", missing: "the treatment decision the MRI will inform" },
  case_summary: "s", confidence: "moderate",
};

function fakeFetch(replies, seen = []) {
  return async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    const [status, payload, headers = {}] = replies.shift();
    return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null },
             text: async () => JSON.stringify(payload) };
  };
}
const okReply = report => [200, {
  model: "claude-sonnet-5-20260630", stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: JSON.stringify(report) }],
  usage: { input_tokens: 9000, output_tokens: 1500, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 },
}, { "request-id": "req_test" }];
const noSleep = async () => {};

test("the request uses the pinned settings, the JSON schema output, and no forced tool use", () => {
  const b = requestBody("hello");
  assert.equal(b.model, "claude-sonnet-5");
  assert.equal(b.max_tokens, SETTINGS.max_tokens);
  assert.deepEqual(b.thinking, { type: "adaptive" });
  assert.equal(b.output_config.effort, "high");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.deepEqual(b.output_config.format.schema, SCHEMA);
  for (const k of ["tools", "tool_choice", "temperature", "top_p", "top_k"]) assert.ok(!(k in b), `${k} must not be sent`);
  assert.equal(b.system[0].text, SYSTEM_PROMPT);
  assert.deepEqual(b.system[0].cache_control, { type: "ephemeral" });
});

test("the schema meets the structured output limits: every object closed, no unsupported keywords", () => {
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false, `${path} must set additionalProperties false`);
    for (const bad of ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "maxItems"]) assert.ok(!(bad in node), `${path} uses ${bad}`);
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(SCHEMA, "schema");
});

test("a good report on the smoke case: the rule requests the C3 document; settings and fingerprints recorded", async () => {
  const seen = [];
  const d = await reviewCase(smoke, { apiKey: "k", caseId: "case_00", fetchImpl: fakeFetch([okReply(smokeReport)], seen), sleep: noSleep });
  assert.equal(d.routing, "request");
  assert.deepEqual(d.named_gap, { criterion: "C3", missing: "the treatment decision the MRI will inform" });
  assert.equal(d.agent_version, AGENT_VERSION);
  assert.equal(d.spec_sha256, SPEC_SHA256);
  assert.equal(d.model.returned, "claude-sonnet-5-20260630");
  assert.equal(d.request_id, "req_test");
  assert.equal(d.error, null);
  assert.equal(seen[0].init.headers["x-api-key"], "k");
  assert.equal(seen[0].init.headers["anthropic-version"], "2023-06-01");
});

test("checklist mode: the same report is routed", async () => {
  const d = await reviewCase(smoke, { apiKey: "k", approveEnabled: false, fetchImpl: fakeFetch([okReply(smokeReport)]), sleep: noSleep });
  assert.equal(d.routing, "route");
  assert.equal(d.checklist_mode, true);
});

test("retries on overload, then succeeds", async () => {
  const seen = [];
  const d = await reviewCase(smoke, { apiKey: "k", sleep: noSleep, fetchImpl: fakeFetch(
    [[529, { error: { message: "overloaded" } }], [429, { error: { message: "rate" } }, { "retry-after": "1" }], okReply(smokeReport)], seen) });
  assert.equal(seen.length, 3);
  assert.equal(d.attempts, 3);
  assert.equal(d.routing, "request");
});

test("any unusable reply routes, with the reason recorded", async () => {
  const cases = [
    [[400, { error: { message: "bad request" } }], /HTTP 400/],
    [[200, { model: "m", stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }], /stopped early/],
    [[200, { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }], /not valid JSON/],
    [[200, { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ criteria: {} }) }] }], /does not match the schema/],
    [[200, { model: "m", stop_reason: "refusal", content: [] }], /stopped early/],
  ];
  for (const [reply, why] of cases) {
    const d = await reviewCase(smoke, { apiKey: "k", fetchImpl: fakeFetch([reply]), sleep: noSleep });
    assert.equal(d.routing, "route");
    assert.match(d.error, why);
  }
});

test("a reply that is not JSON routes instead of stopping the run", async () => {
  const notJson = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>gateway</html>" });
  const d = await reviewCase(smoke, { apiKey: "k", fetchImpl: notJson, sleep: noSleep });
  assert.equal(d.routing, "route");
  assert.match(d.error, /not JSON/);
});

test("each call carries a timeout, and a timed-out call is tried again", async () => {
  const seen = [];
  let first = true;
  const f = async (url, init) => {
    seen.push(init.signal);
    if (first) { first = false; throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); }
    return fakeFetch([okReply(smokeReport)])(url, init);
  };
  const d = await reviewCase(smoke, { apiKey: "k", fetchImpl: f, sleep: noSleep });
  assert.ok(seen.every(s => s instanceof AbortSignal));
  assert.equal(d.attempts, 2);
  assert.equal(d.routing, "request");
});

test("no field asks the model to write out its reasoning (the API declines such requests on some models)", () => {
  assert.ok(!JSON.stringify(SCHEMA).includes("reasoning"));
  assert.ok(!/\breasoning\b|\bthinking\b|scratchpad/i.test(SYSTEM_PROMPT.split("=== CRITERIA")[0]));
});

test("a missing key is refused before anything is sent", async () => {
  await assert.rejects(reviewCase(smoke, { apiKey: "", fetchImpl: () => { throw new Error("sent"); } }), /no API key/);
});

test("the agent folder uses nothing a Cloudflare Worker lacks", () => {
  for (const f of readdirSync("agent").filter(f => f.endsWith(".js"))) {
    const src = readFileSync(`agent/${f}`, "utf8");
    assert.ok(!/from\s+["']node:|require\(|process\.|Buffer\./.test(src), `${f} uses a Node-only feature`);
  }
});
