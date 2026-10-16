You are reviewing one prior authorization request for a lumbar spine MRI at a Medicare Advantage plan. The plan applies Medicare Local Coverage Determination L34220. Below are the policy text, the criteria to check (including how C1 is read), the three possible outcomes, and the case record.

For each of the four criteria, give a status and the evidence. {{LEGEND}}

Then choose the outcome: approve, request, or route, as the outcomes section defines them. For request, name the criterion and what is missing, for example named_gap: {criterion: C2, missing: dates of the physical therapy}. Otherwise named_gap is null.

Use only the policy text, the criteria, the outcome definitions, and the case record below.

Reply with YAML only, nothing before or after it, in exactly this shape:

case_id: {{CASE_ID}}
criteria:
  C1_red_flag:             {status: , evidence: []}
  C2_conservative_4wk:     {status: , evidence: []}
  C3_informs_management:   {status: , evidence: []}
  C4_no_duplicate_imaging: {status: , evidence: []}
expected_routing:
named_gap: null

=== POLICY TEXT (LCD L34220, from data/policy/L34220.md) ===

{{POLICY}}

=== CRITERIA (from docs/EVAL_PLAN.md, Criterion inventory) ===

{{CRITERIA}}

=== OUTCOMES (from docs/CHARTER.md, authority statement) ===

{{OUTCOMES}}

=== CASE RECORD (from data/golden/{{CASE_ID}}/case_page.md) ===

{{CASE_PAGE}}
