// Tests of the fixed routing rule (agent/routing.js), one scenario per rule in ADR-10 (1) and EVAL_PLAN.md.
// Run from the repository root: node --test agent/test/
// The ids and statuses below are made-up test values for the rule; they describe no golden case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRouting } from "../routing.js";

const ctx = (over = {}) => ({
  validIds: new Set(["Claim/r", "Patient/p", "Procedure/pt", "MedicationRequest/m", "Observation/o", "Condition/c",
                     "Encounter/e", "DocumentReference/n", "note:p1", "note:p2", "note:p3"]),
  noteIds: new Set(["DocumentReference/n", "note:p1", "note:p2", "note:p3"]),
  passageIds: new Set(["L34220-15", "L34220-36", "L34220-39", "L34220-41"]),
  approveEnabled: true, ...over,
});
const crit = (status, evidence = [], passages = ["L34220-39"]) =>
  ({ status, evidence, policy_passages: passages, policy_quote: "q", reasoning: "r" });

// An approvable report on C2: therapy Procedure cited; C3 supported from the note; C4 supported with empty evidence.
function report(over = {}) {
  return {
    criteria: {
      C1_red_flag: crit("unsupported", [], ["L34220-15"]),
      C2_conservative_4wk: crit("supported", ["Procedure/pt", "MedicationRequest/m"], ["L34220-36"]),
      C3_informs_management: crit("supported", ["note:p2"], ["L34220-39"]),
      C4_no_duplicate_imaging: crit("supported", [], ["L34220-41"]),
      ...(over.criteria || {}),
    },
    contradictions: over.contradictions || [],
    missing_document: over.missing_document === undefined ? null : over.missing_document,
  };
}

test("approves on C2 with a therapy Procedure, C3 and C4 supported", () => {
  const v = decideRouting(report(), ctx());
  assert.equal(v.routing, "approve");
  assert.equal(v.basis, "C2");
});

test("approves on C1 with a structured entry other than the note", () => {
  const v = decideRouting(report({ criteria: {
    C1_red_flag: crit("supported", ["Observation/o", "note:p1"], ["L34220-15"]),
    C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) } }), ctx());
  assert.equal(v.routing, "approve");
  assert.equal(v.basis, "C1");
});

test("does not approve on C1 when only the note supports it", () => {
  for (const ev of [["note:p1"], ["DocumentReference/n"], ["note:p1", "note:p3", "DocumentReference/n"]]) {
    const v = decideRouting(report({ criteria: {
      C1_red_flag: crit("supported", ev, ["L34220-15"]),
      C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) } }), ctx());
    assert.equal(v.routing, "route", ev.join(","));
  }
});

test("does not approve on C2 without a therapy Procedure or medication order", () => {
  for (const ev of [["note:p1"], ["Encounter/e"], ["Condition/c", "note:p2"]]) {
    const v = decideRouting(report({ criteria: { C2_conservative_4wk: crit("supported", ev, ["L34220-36"]) } }), ctx());
    assert.notEqual(v.routing, "approve", ev.join(","));
  }
});

test("an id that is not in the case routes, even when the rest would approve", () => {
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("supported", ["note:p9"], ["L34220-39"]) } }), ctx());
  assert.equal(v.routing, "route");
  assert.deepEqual(v.invalid_evidence, ["note:p9"]);
});

test("an id cited only in a contradiction must also exist", () => {
  const v = decideRouting(report({ contradictions: [{ criterion: "C1", description: "d", evidence: ["Observation/missing"] }] }), ctx());
  assert.equal(v.routing, "route");
});

test("every applicable criterion needs a valid policy passage", () => {
  assert.equal(decideRouting(report({ criteria: { C4_no_duplicate_imaging: crit("supported", [], []) } }), ctx()).routing, "route");
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("supported", ["note:p2"], ["L34220-99"]) } }), ctx());
  assert.equal(v.routing, "route");
  assert.deepEqual(v.invalid_policy_passages, ["L34220-99"]);
});

test("C3 supported with no record entry cited does not approve", () => {
  assert.equal(decideRouting(report({ criteria: { C3_informs_management: crit("supported", [], ["L34220-39"]) } }), ctx()).routing, "route");
});

test("a contradiction on an applicable criterion blocks approval", () => {
  const v = decideRouting(report({ contradictions: [{ criterion: "C2", description: "d", evidence: ["Procedure/pt", "note:p1"] }] }), ctx());
  assert.equal(v.routing, "route");
});

test("a contradiction on the criterion the approval does not rest on does not block it", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("undeterminable", ["note:p1"], ["L34220-15"]) },
                                   contradictions: [{ criterion: "C1", description: "d", evidence: ["Condition/c", "note:p1"] }] }), ctx());
  assert.equal(v.routing, "approve");
  assert.equal(v.basis, "C2");
});

test("requests when one criterion is undeterminable for want of one named document", () => {
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("undeterminable", [], ["L34220-39"]) },
                                   missing_document: { criterion: "C3", missing: "the treatment decision the MRI will inform" } }), ctx());
  assert.equal(v.routing, "request");
  assert.deepEqual(v.named_gap, { criterion: "C3", missing: "the treatment decision the MRI will inform" });
});

test("requests on C2 when C2 is the one criterion short", () => {
  const v = decideRouting(report({ criteria: { C2_conservative_4wk: crit("undeterminable", ["note:p1"], ["L34220-36"]) },
                                   missing_document: { criterion: "C2", missing: "a named record" } }), ctx());
  assert.equal(v.routing, "request");
});

test("never requests on C1", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("undeterminable", ["note:p1"], ["L34220-15"]),
                                               C2_conservative_4wk: crit("unsupported", [], ["L34220-36"]) },
                                   missing_document: { criterion: "C1", missing: "an exam finding" } }), ctx());
  assert.equal(v.routing, "route");
});

test("routes instead of requesting when the record contradicts itself on any criterion", () => {
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("undeterminable", [], ["L34220-39"]) },
                                   contradictions: [{ criterion: "C1", description: "d", evidence: ["Condition/c", "note:p1"] }],
                                   missing_document: { criterion: "C3", missing: "x" } }), ctx());
  assert.equal(v.routing, "route");
});

test("routes when two criteria stand in the way, even if one document is named", () => {
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("undeterminable", [], ["L34220-39"]),
                                               C4_no_duplicate_imaging: crit("undeterminable", [], ["L34220-41"]) },
                                   missing_document: { criterion: "C3", missing: "x" } }), ctx());
  assert.equal(v.routing, "route");
});

test("routes when the named criterion is unsupported rather than undeterminable", () => {
  const v = decideRouting(report({ criteria: { C4_no_duplicate_imaging: crit("unsupported", ["Procedure/pt"], ["L34220-41"]) },
                                   missing_document: { criterion: "C4", missing: "x" } }), ctx());
  assert.equal(v.routing, "route");
});

test("routes when no document is named", () => {
  const v = decideRouting(report({ criteria: { C3_informs_management: crit("undeterminable", [], ["L34220-39"]) } }), ctx());
  assert.equal(v.routing, "route");
});

test("a note-only red flag and a C2 gap: the literal rule requests (flagged for the owner in the pull request)", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("undeterminable", ["note:p1"], ["L34220-15"]),
                                               C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) },
                                   missing_document: { criterion: "C2", missing: "therapy records" } }), ctx());
  assert.equal(v.routing, "request");
});

test("checklist mode routes everything, approvals and requests included", () => {
  assert.equal(decideRouting(report(), ctx({ approveEnabled: false })).routing, "route");
  const r = report({ criteria: { C3_informs_management: crit("undeterminable", [], ["L34220-39"]) },
                     missing_document: { criterion: "C3", missing: "x" } });
  assert.equal(decideRouting(r, ctx({ approveEnabled: false })).routing, "route");
});

test("every decision carries plain reasons", () => {
  for (const r of [report(), report({ criteria: { C3_informs_management: crit("unsupported", [], ["L34220-39"]) } })]) {
    const v = decideRouting(r, ctx());
    assert.ok(v.reasons.length > 0 && v.reasons.every(s => typeof s === "string" && s.length > 10));
  }
});
