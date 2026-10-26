// Starts the demo on this computer for the tests: the real Worker code in Cloudflare's local runtime (wrangler dev
// --local) with an empty local database, and a fake model server standing in for api.anthropic.com. Nothing touches
// Cloudflare or Anthropic. The demo's content is built first from the repository (demo/build_demo.py).
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";

// A fresh connection per request: reusing an idle one can race the local server closing it (a test-only failure).
setGlobalDispatcher(new Agent({ pipelining: 0 }));

export const DEMO = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = dirname(DEMO);
export const PASSCODE = "test-passcode-0123";
export const FAKE_KEY = "sk-ant-test-fake-key-must-never-appear-in-a-response";
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

export function build(extra = []) {
  execFileSync("python3", ["demo/build_demo.py", ...extra], { cwd: ROOT, stdio: "ignore" });
}

// The labels a case's fake report is built from: the owner's final labels, so an approvable case's report really is
// approvable. Only the tests read labels; the demo never does.
export function finalLabels(caseId) {
  const text = readFileSync(join(ROOT, "data/golden", caseId, "labels.yaml"), "utf8");
  const out = {};
  for (const k of ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]) {
    const m = text.match(new RegExp("^  " + k + ":\\s*\\{status: (\\w+), evidence: \\[([^\\]]*)\\]\\}", "m"));
    out[k] = { status: m[1], evidence: m[2].split(",").map(s => s.trim()).filter(Boolean) };
  }
  return out;
}
const PASSAGE = { C1_red_flag: "L34220-30", C2_conservative_4wk: "L34220-36", C3_informs_management: "L34220-39", C4_no_duplicate_imaging: "L34220-41" };
export function reportFrom(labels, { missing = null, contradictions = [] } = {}) {
  const criteria = {};
  for (const [k, v] of Object.entries(labels))
    criteria[k] = { explanation: "From the record.", evidence: v.evidence, policy_passages: [PASSAGE[k]], policy_quote: "quoted words", status: v.status };
  return { criteria, contradictions, missing_document: missing, case_summary: "A neutral summary.", confidence: "moderate" };
}

// A fake Messages API. `fake.reply` decides each answer: { report } | { status, body } | { hang: true } | { delayMs, report }.
export async function startFakeModel() {
  const fake = { calls: [], reply: () => ({ report: reportFrom(finalLabels("case_01")) }) };
  const server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c);
    req.on("end", async () => {
      const call = { key: req.headers["x-api-key"], body: JSON.parse(body || "{}") };
      fake.calls.push(call);
      const r = fake.reply(call);
      if (r.hang) return;   // never answers
      if (r.delayMs) await new Promise(x => setTimeout(x, r.delayMs));
      res.setHeader("content-type", "application/json"); res.setHeader("request-id", "req_fake");
      if (r.status) { res.statusCode = r.status; return res.end(JSON.stringify(r.body || { error: { message: "fake failure" } })); }
      res.end(JSON.stringify({ model: "claude-sonnet-5-fake", stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(r.report) }], usage: { input_tokens: 10, output_tokens: 10 } }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${server.address().port}/v1/messages`;
  fake.stop = () => { server.closeAllConnections?.(); server.close(); };
  return fake;
}

// vars: Worker settings for this run. A value of null leaves that setting out, as if the deploy never set it.
export async function startDemo(vars = {}) {
  const port = 19700 + Math.floor(Math.random() * 1000);
  const persist = mkdtempSync(join(tmpdir(), "demo-"));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "prior-auth-demo", "--local", "--persist-to", persist],
    { cwd: DEMO, env: ENV, stdio: "ignore" });
  const all = { ANTHROPIC_API_KEY: FAKE_KEY, DEMO_PASSCODE: PASSCODE, ...vars };
  const args = ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persist];
  for (const [k, v] of Object.entries(all)) if (v !== null && v !== undefined) args.push("--var", `${k}:${v}`);
  const dev = spawn("npx", args, { cwd: DEMO, env: ENV, stdio: "ignore", detached: true });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => { try { process.kill(-dev.pid); } catch (e) {} rmSync(persist, { recursive: true, force: true }); };
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + "/api/status")).ok) return { base, port, persist, stop }; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  stop();
  throw new Error("the local demo did not start");
}

// Sends a live run and reads the streamed lines. Returns { status, json } for a refusal, or { status, lines }.
export async function live(base, caseId, passcode = PASSCODE, headers = { "X-Demo": "1" }) {
  const r = await fetch(`${base}/api/run/${caseId}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ passcode }) });
  const text = await r.text();
  if (!r.ok) return { status: r.status, json: JSON.parse(text), text };
  return { status: r.status, text, lines: text.trim().split("\n").map(l => JSON.parse(l)) };
}
