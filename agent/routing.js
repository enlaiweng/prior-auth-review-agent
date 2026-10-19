// The fixed routing rule (docs/ARCHITECTURE.md, ADR-10 (1) and ADR-12; docs/EVAL_PLAN.md, Criterion inventory).
// The model reports each criterion's status and evidence; this code, not the model, chooses the outcome.
// Part of the versioned agent specification: a change here is a new agent version, and agent/test/routing.test.js
// must still pass. No case-specific or patient-specific logic belongs in this file.

export const CRITERIA = {
  C1: "C1_red_flag",
  C2: "C2_conservative_4wk",
  C3: "C3_informs_management",
  C4: "C4_no_duplicate_imaging",
};
const KEYS = Object.values(CRITERIA);

// The record entries that can document a red flag (EVAL_PLAN.md, C1: "a Condition, Observation, Procedure,
// DiagnosticReport, or other discrete entry"). The request itself (Claim), the Patient, the visits (Encounter), and the
// note (DocumentReference) do not count: none of them records a clinical finding.
const C1_TYPES = ["Condition/", "Observation/", "Procedure/", "DiagnosticReport/", "MedicationRequest/"];
// The record entries that can document conservative care (EVAL_PLAN.md, C2: "a therapy Procedure or a medication order").
const C2_TYPES = ["Procedure/", "MedicationRequest/"];
// A therapy entry counts for C2 only if it starts on or before the request date and no more than this many days before
// it, so a decades-old order for an unrelated condition cannot stand in for this episode's care.
export const C2_WINDOW_DAYS = 365;

// ctx: { validIds: Set of citable ids in this case, noteIds: Set of the note's own ids (its DocumentReference and its
//        paragraphs), passageIds: Set of policy passage ids, entryStart: Map of id to start date (YYYY-MM-DD) for
//        Procedures and medication orders, requestDate: YYYY-MM-DD, approveEnabled: false in checklist mode }

function isNote(id, ctx) { return ctx.noteIds.has(id) || id.startsWith("note:p"); }

function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

function inEpisode(id, ctx) {
  const start = ctx.entryStart?.get(id);
  if (!start || !ctx.requestDate) return false;
  const d = daysBetween(start, ctx.requestDate);
  return d >= 0 && d <= C2_WINDOW_DAYS;
}

function hasStructuredEvidence(shortName, c, ctx) {
  if (shortName === "C1") return c.evidence.some(id => C1_TYPES.some(t => id.startsWith(t)));
  if (shortName === "C2") return c.evidence.some(id => C2_TYPES.some(t => id.startsWith(t)) && inEpisode(id, ctx));
  return true;
}

function hasPolicyCitation(c, ctx) { return c.policy_passages.some(p => ctx.passageIds.has(p)); }

function contradicted(shortName, report) { return report.contradictions.some(x => x.criterion === shortName); }

// Whether one criterion is met for an approval. `assumed` names a criterion treated as met, to test whether a single
// missing document would make the case approvable.
function met(shortName, report, ctx, assumed) {
  if (shortName === assumed) return true;
  const c = report.criteria[CRITERIA[shortName]];
  if (c.status !== "supported" || contradicted(shortName, report) || !hasPolicyCitation(c, ctx)) return false;
  if (shortName === "C3" && c.evidence.length === 0) return false; // C3 rests on something the record says
  return hasStructuredEvidence(shortName, c, ctx);                  // C4 may rest on an absence (empty evidence)
}

// The approval test: C3 and C4 met, and C1 or C2 met with a record entry other than the note behind it.
// Returns the criterion the approval rests on, or null.
function approvalBasis(report, ctx, assumed) {
  if (!met("C3", report, ctx, assumed) || !met("C4", report, ctx, assumed)) return null;
  if (met("C1", report, ctx, assumed)) return "C1";
  if (met("C2", report, ctx, assumed)) return "C2";
  return null;
}

// An open red flag: one that rests on the note alone, or that the record contradicts (EVAL_PLAN.md, C1: such a red flag
// "is labeled undeterminable"; ADR-12). It can never carry an approval, and it does not block one that C2 carries. When
// the case is not approvable, it routes the case rather than requesting a document. Three ways the report can show one:
//   - a contradiction reported on C1;
//   - C1 called supported without an entry that can document a red flag (the claim then rests on the note, or on
//     nothing the rule accepts);
//   - C1 called undeterminable while citing the note (the red-flag question is open because of what the note says).
// C1 unsupported, or undeterminable without citing the note, is not an open red flag.
function openRedFlag(report, ctx) {
  const c = report.criteria[CRITERIA.C1];
  if (contradicted("C1", report)) return "the record contradicts itself on C1, the red-flag criterion";
  if (c.status === "supported" && !hasStructuredEvidence("C1", c, ctx))
    return "a red flag is reported without a Condition, Observation, Procedure, imaging report, or medication order behind it";
  if (c.status === "undeterminable" && c.evidence.some(id => isNote(id, ctx)))
    return "the red-flag question is left open by what the visit note says";
  return null;
}

export function citedIds(report) {
  const ids = [];
  for (const k of KEYS) ids.push(...report.criteria[k].evidence);
  for (const x of report.contradictions) ids.push(...x.evidence);
  return ids;
}

// Returns { routing, named_gap, basis, reasons, invalid_evidence, invalid_policy_passages }.
export function decideRouting(report, ctx) {
  const reasons = [];
  const invalid = [...new Set(citedIds(report).filter(id => !ctx.validIds.has(id)))];
  const invalidPassages = [...new Set(KEYS.flatMap(k => report.criteria[k].policy_passages).filter(p => !ctx.passageIds.has(p)))];
  const out = (routing, extra = {}) => ({ routing, named_gap: null, basis: null, reasons, invalid_evidence: invalid,
                                          invalid_policy_passages: invalidPassages, ...extra });

  if (ctx.approveEnabled === false) {
    reasons.push("Checklist mode is on: the approve output and documentation requests are off, so every case is routed with its criteria (RUNBOOK.md, Kill switch).");
    return out("route");
  }
  if (invalid.length) {
    reasons.push(`Cited ids not found in this case: ${invalid.join(", ")}. A decision cannot rest on them, so the case is routed.`);
    return out("route");
  }
  const redFlag = openRedFlag(report, ctx);
  const basis = approvalBasis(report, ctx, null);
  if (basis) {
    reasons.push(`C3 and C4 are supported, and ${basis} is supported with a record entry other than the visit note; every applicable criterion cites the policy and every cited id exists in the case.`);
    if (redFlag) reasons.push(`Also noted: ${redFlag}. C1 is not met, so the approval rests on ${basis}, not on the red flag (ADR-12).`);
    return out("approve", { basis });
  }
  reasons.push("Not approvable: " + shortfall(report, ctx) + ".");
  if (redFlag) {
    reasons.push(`Routed because ${redFlag}; when a case is not approvable, a red-flag question goes to a physician rather than to a document request (EVAL_PLAN.md, C1; ADR-12).`);
    return out("route");
  }

  const md = report.missing_document;
  if (!md) {
    reasons.push("No single missing document was named, so the case is routed.");
    return out("route");
  }
  if (md.criterion === "C1") {
    reasons.push("The named gap is on C1; a gap on the red-flag criterion routes.");
    return out("route");
  }
  if (report.contradictions.length) {
    reasons.push("The record contradicts itself on " + [...new Set(report.contradictions.map(x => x.criterion))].join(", ") + ", so the case is routed, even though a document might resolve it.");
    return out("route");
  }
  if (report.criteria[CRITERIA[md.criterion]].status !== "undeterminable") {
    reasons.push(`The named gap is on ${md.criterion}, but ${md.criterion} is not undeterminable, so no single document would settle it.`);
    return out("route");
  }
  if (!approvalBasis(report, ctx, md.criterion)) {
    reasons.push(`Even with the document named for ${md.criterion}, the case would not meet the approval test, so the case is routed.`);
    return out("route");
  }
  reasons.push(`The case falls short only on ${md.criterion}, which is undeterminable for want of one named document, and nothing in the record is contradicted.`);
  return out("request", { named_gap: { criterion: md.criterion, missing: md.missing } });
}

// A plain list of what keeps the case from approval, for the reasons shown to the reviewer.
function shortfall(report, ctx) {
  const parts = [];
  for (const s of ["C3", "C4"]) if (!met(s, report, ctx, null)) parts.push(`${s} is not met (${why(s, report, ctx)})`);
  if (!met("C1", report, ctx, null) && !met("C2", report, ctx, null)) {
    parts.push(`neither C1 (${why("C1", report, ctx)}) nor C2 (${why("C2", report, ctx)}) is met`);
  }
  return parts.join("; ");
}

function why(s, report, ctx) {
  const c = report.criteria[CRITERIA[s]];
  if (c.status !== "supported") return c.status;
  if (contradicted(s, report)) return "contradicted in the record";
  if (!hasPolicyCitation(c, ctx)) return "no policy passage cited";
  if (s === "C3" && c.evidence.length === 0) return "no record entry cited";
  if (s === "C1") return "no Condition, Observation, Procedure, imaging report, or medication order cited";
  if (s === "C2") return `no therapy Procedure or medication order from the ${C2_WINDOW_DAYS} days before the request cited`;
  return "not met";
}
