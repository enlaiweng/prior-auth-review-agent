// Print one GitHub notice per decision in a run folder, plus one for the run: the decision in brief, so a reader of
// the run's log or check annotations sees it without downloading the artifact.
// Usage: node eval/print_notices.mjs eval/runs/NAME
import { readFileSync, readdirSync } from "node:fs";

const dir = process.argv[2];
const esc = s => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const run = JSON.parse(readFileSync(`${dir}/run.json`, "utf8"));
for (const f of readdirSync(dir).filter(f => /^case_.*\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const brief = {
    routing: d.routing, named_gap: d.named_gap, basis: d.basis, error: d.error, reasons: d.routing_reasons,
    criteria: d.criteria && Object.fromEntries(Object.entries(d.criteria).map(([k, c]) =>
      [k, { status: c.status, evidence: c.evidence, passages: c.policy_passages, quote: c.policy_quote, explanation: c.explanation }])),
    contradictions: d.contradictions, missing_document_suggested: d.missing_document_suggested, confidence: d.confidence,
    invalid_evidence: d.invalid_evidence, model_returned: d.model.returned, stop_reason: d.stop_reason, usage: d.usage,
    cost_usd_estimate: run.cases[d.case_id]?.cost_usd_estimate, seconds: d.seconds,
  };
  console.log(`::notice title=${d.case_id}: ${d.routing}::${esc(JSON.stringify(brief))}`);
}
console.log(`::notice title=Run ${dir.split("/").pop()}::${esc(JSON.stringify({ agent_version: run.agent_version, spec: run.spec_sha256, settings: run.settings, models_returned: run.models_returned, errors: run.errors, cost_usd_estimate_total: run.cost_usd_estimate_total }))}`);
