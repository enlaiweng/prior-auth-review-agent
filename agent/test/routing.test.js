// Tests of the fixed routing rule (agent/routing.js), one scenario per rule in ADR-10 (1), ADR-12, and EVAL_PLAN.md.
// Run from the repository root: node --test agent/test/
// The ids and statuses below are made-up test values for the rule; they describe no golden case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRouting } from "../routing.js";

const ctx = (over = {}) => ({
  validIds: new Set(["Claim/r", "Patient/p", "Procedure/pt", "MedicationRequest/m", "MedicationRequest/old", "Procedure/nodate",
                     "Observation/o", "Condition/c", "Encounter/e", "DocumentReference/n", "note:p1", "note:p2", "note:p3"]),
  noteIds: new Set(["DocumentReference/n", "note:p1", "note:p2", "note:p3"]),
  passageIds: new Set(["L34220-15", "L34220-36", "L34220-39", "L34220-41"]),
  entryStart: new Map([["Procedure/pt", "2026-06-04"], ["MedicationRequest/m", "2026-05-20"], ["MedicationRequest/old", "1982-01-01"]]),
  requestDate: "2026-08-15",
  approveEnabled: true, ...over,
});
const crit = (status, evidence = [], passages = ["L34220-39"]) =>
  ({ status, evidence, policy_passages: passages, policy_quote: "q", explanation: "e" });

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

test("the request, the patient, or a visit cannot stand behind a red flag", () => {
  for (const ev of [["note:p1", "Patient/p"], ["note:p1", "Claim/r"], ["note:p1", "Encounter/e"], ["Encounter/e"], ["Patient/p"]]) {
    const v = decideRouting(report({ criteria: {
      C1_red_flag: crit("supported", ev, ["L34220-15"]),
      C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) } }), ctx());
    assert.equal(v.routing, "route", ev.join(","));
  }
});

// ADR-12: an open red flag (on the note alone, unbacked, or contradicted) never carries an approval, and does not block
// one that C2 carries. When the case is not approvable, it routes.
test("a red flag resting on the note alone does not block an approval C2 carries, and the reasons say so", () => {
  for (const status of ["supported", "undeterminable"]) {
    const v = decideRouting(report({ criteria: { C1_red_flag: crit(status, ["note:p1", "Patient/p"], ["L34220-15"]) } }), ctx());
    assert.equal(v.routing, "approve", status);
    assert.equal(v.basis, "C2", status);
    assert.match(v.reasons.join(" "), /For the reviewer: .*(visit note|without a Condition)/, status);
  }
});

test("a red flag resting on the note alone routes when C2 does not carry an approval", () => {
  for (const status of ["supported", "undeterminable"]) {
    const v = decideRouting(report({ criteria: { C1_red_flag: crit(status, ["note:p1", "Patient/p"], ["L34220-15"]),
                                                 C2_conservative_4wk: crit("unsupported", [], ["L34220-36"]) } }), ctx());
    assert.equal(v.routing, "route", status);
    assert.match(v.reasons.join(" "), /Routed because .*(visit note|without a Condition)/, status);
  }
});

test("a red flag reported as supported with nothing the rule accepts behind it never carries an approval", () => {
  for (const ev of [[], ["Encounter/e"], ["Claim/r", "Patient/p"]]) {
    const onC2 = decideRouting(report({ criteria: { C1_red_flag: crit("supported", ev, ["L34220-15"]) } }), ctx());
    assert.equal(onC2.routing, "approve", ev.join(","));
    assert.equal(onC2.basis, "C2", ev.join(","));
    const alone = decideRouting(report({ criteria: { C1_red_flag: crit("supported", ev, ["L34220-15"]),
                                                     C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) } }), ctx());
    assert.equal(alone.routing, "route", ev.join(","));
  }
});

test("C1 left undeterminable by the note, with a structured entry cited, approves on C2 and routes without it", () => {
  const c1 = crit("undeterminable", ["note:p1", "Condition/c"], ["L34220-15"]);
  const v = decideRouting(report({ criteria: { C1_red_flag: c1 } }), ctx());
  assert.equal(v.routing, "approve");
  assert.match(v.reasons.join(" "), /visit note/);
  const w = decideRouting(report({ criteria: { C1_red_flag: c1, C2_conservative_4wk: crit("unsupported", [], ["L34220-36"]) } }), ctx());
  assert.equal(w.routing, "route");
  assert.match(w.reasons.join(" "), /visit note/);
});

test("C1 undeterminable without the note cited does not stop an approval on C2", () => {
  assert.equal(decideRouting(report({ criteria: { C1_red_flag: crit("undeterminable", [], ["L34220-15"]) } }), ctx()).routing, "approve");
});

test("a note that rules red flags out does not stop an approval on C2", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("unsupported", ["note:p1"], ["L34220-15"]) } }), ctx());
  assert.equal(v.routing, "approve");
});

test("does not approve on C2 without a therapy Procedure or medication order", () => {
  for (const ev of [["note:p1"], ["Encounter/e"], ["Condition/c", "note:p2"]]) {
    const v = decideRouting(report({ criteria: { C2_conservative_4wk: crit("supported", ev, ["L34220-36"]) } }), ctx());
    assert.notEqual(v.routing, "approve", ev.join(","));
  }
});

test("C2's therapy must start within the year before the request, and have a date", () => {
  for (const ev of [["MedicationRequest/old"], ["Procedure/nodate"], ["MedicationRequest/old", "note:p1"]]) {
    const v = decideRouting(report({ criteria: { C2_conservative_4wk: crit("supported", ev, ["L34220-36"]) } }), ctx());
    assert.notEqual(v.routing, "approve", ev.join(","));
  }
  const after = ctx({ entryStart: new Map([["Procedure/pt", "2026-09-01"]]) });
  assert.notEqual(decideRouting(report({ criteria: { C2_conservative_4wk: crit("supported", ["Procedure/pt"], ["L34220-36"]) } }), after).routing, "approve");
  assert.equal(decideRouting(report({ criteria: { C2_conservative_4wk: crit("supported", ["MedicationRequest/old", "Procedure/pt"], ["L34220-36"]) } }), ctx()).routing, "approve");
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

test("a red flag the record contradicts does not block an approval C2 carries, and routes when C2 does not", () => {
  const c1 = crit("undeterminable", ["note:p1", "Condition/c"], ["L34220-15"]);
  const contradictions = [{ criterion: "C1", description: "d", evidence: ["Condition/c", "note:p1"] }];
  const v = decideRouting(report({ criteria: { C1_red_flag: c1 }, contradictions }), ctx());
  assert.equal(v.routing, "approve");
  assert.equal(v.basis, "C2");
  assert.match(v.reasons.join(" "), /contradicts itself on C1/);
  const w = decideRouting(report({ criteria: { C1_red_flag: c1, C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) },
                                   contradictions, missing_document: { criterion: "C2", missing: "a named record" } }), ctx());
  assert.equal(w.routing, "route");
  assert.match(w.reasons.join(" "), /contradicts itself on C1/);
});

test("a contradiction on C1 never lets C1 carry an approval", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("supported", ["Observation/o"], ["L34220-15"]),
                                               C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) },
                                   contradictions: [{ criterion: "C1", description: "d", evidence: ["Observation/o", "note:p1"] }] }), ctx());
  assert.equal(v.routing, "route");
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

test("a red flag resting on the note alone routes instead of requesting a C2 document", () => {
  const v = decideRouting(report({ criteria: { C1_red_flag: crit("undeterminable", ["note:p1"], ["L34220-15"]),
                                               C2_conservative_4wk: crit("undeterminable", [], ["L34220-36"]) },
                                   missing_document: { criterion: "C2", missing: "a named record" } }), ctx());
  assert.equal(v.routing, "route");
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
