// Decides a stored decision's outcome again, under the mode the demo is in now.
//
// A stored decision (from an evaluation run in eval/runs/) holds the model's per-criterion report. The demo never shows
// the routing written in that file: it runs the same fixed rule as the agent (agent/routing.js) on the stored report,
// with the approve output on or off as the demo's CHECKLIST_MODE says. So the off switch covers stored decisions as
// well as live runs, and an approval on screen is always one the rule makes now.
//
// The context passed to decideRouting is built exactly as agent/agent.js reviewCase builds it; demo/test/decide.test.js
// checks that the two agree on every case. No case-specific logic here.

import { readCase } from "../../agent/record.js";
import { decideRouting } from "../../agent/routing.js";
import { PASSAGE_IDS } from "../../agent/spec.generated.js";

export function redecide(bundle, stored, approveEnabled) {
  if (!stored) return null;
  const shown = {
    criteria: stored.criteria, contradictions: stored.contradictions,
    missing_document_suggested: stored.missing_document_suggested, case_summary: stored.case_summary,
    confidence: stored.confidence, model: stored.model, seconds: stored.seconds, error: stored.error,
    checklist_mode: approveEnabled === false,
  };
  if (stored.error || !stored.criteria) {
    return Object.assign(shown, {
      routing: "route", named_gap: null, basis: null,
      routing_reasons: [`The model's report could not be used (${stored.error || "no report"}), so the case is routed.`],
      invalid_evidence: [], invalid_policy_passages: [],
    });
  }
  const rc = readCase(bundle);
  const report = { criteria: stored.criteria, contradictions: stored.contradictions,
                   missing_document: stored.missing_document_suggested, case_summary: stored.case_summary,
                   confidence: stored.confidence };
  const verdict = decideRouting(report, {
    validIds: new Set(rc.citableIds), noteIds: rc.noteIds, passageIds: new Set(PASSAGE_IDS), approveEnabled,
    entryStart: rc.entryStart, requestDate: rc.requestDate,
  });
  return Object.assign(shown, {
    routing: verdict.routing, named_gap: verdict.named_gap, basis: verdict.basis, routing_reasons: verdict.reasons,
    invalid_evidence: verdict.invalid_evidence, invalid_policy_passages: verdict.invalid_policy_passages,
  });
}
