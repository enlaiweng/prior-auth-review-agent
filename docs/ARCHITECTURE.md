# Architecture

EDOM Phase 2 commitment: the Integration Architecture Decision, with the Explainability Design and the Data and Model Plan. Written once before build; decision records appended as they happen.

Committed on: [date, before the first agent prompt is written].

## Integration architecture decision

Embedding pattern: the agent sits behind the reviewer's worklist. Intake is a FHIR R4 bundle shaped like a Da Vinci PAS request: a Claim with use "preauthorization" naming the requested procedure by SNOMED CT concept and text (CPT codes are deliberately not used, because the AMA license bars redistributing them), plus the supporting Patient, Condition, Procedure, Observation, MedicationRequest, Encounter, and DocumentReference resources. Coverage and the requesting Practitioner are omitted on purpose; full PAS conformance is out of scope (CHARTER.md). Output is a structured decision object (routing, per-criterion status, citations, missing items, confidence) that a UM platform would render on the request screen. In this repository the "platform" is a minimal demo surface: In this repository the "platform" is a minimal demo surface: a Cloudflare Worker endpoint accepts a request selecting one of the twenty golden-set cases, invokes the agent, and returns the decision with its per-criterion citations to a single static HTML viewer, where the last twenty decisions also appear in an audit list. No SMART launch or CDS Hooks is implemented; the decision point is the worklist, not the EHR.

Why this and not a chatbot: the reviewer never types a question. The record arrives, the checklist comes back.

## Explainability design

At the decision point the reviewer sees, for every applicable criterion: status (supported, unsupported, undeterminable); the record element that supports it, by resource and identifier; the policy text it was checked against, quoted; and, for documentation requests, the named gap. The routing decision carries a one-paragraph rationale. Confidence is shown as a tier (high, moderate, low), not a percentage. Approvals are issued by the system and appear in the reviewer's audit queue with the same citations; reversal of an approval is a reviewer action recorded in the demo surface. The physician-route summary is written as a case summary, never as a recommendation to deny. A documentation request that is not answered before the clock expires is routed to physician review automatically.

## Data and model plan

Data sources: Synthea-generated patients (Apache 2.0) for demographics and baseline history; authored clinical episodes and notes written for each golden case; policy text from the CMS Medicare Coverage Database (Noridian LCD L34220 narrative, revision effective October 23, 2025, quoted with attribution; code tables not redistributed). No real patient data. Labeling: per-criterion adjudication by protocol (DATASHEET.md).

Model: claude-sonnet-5; a second version for the vendor-update re-evaluation: claude-sonnet-4-6. Retrieval: the policy text split by criterion and retrieved per case; cached so it is not re-sent per call. Structured output: a fixed decision schema validated before display. Vendor dependency chain: Anthropic, Claude API, Synthea, HL7 FHIR validator.

Data flow with the sensitive-data boundary:

```
Synthea + authored episodes  -->  FHIR R4 bundles (validated)  -->  agent (LLM API)  -->  decision object  -->  demo surface
(synthetic only: no PHI anywhere; boundary is therefore trivial and stated for the record)
Golden set + adjudication labels  -->  evaluation harness  -->  EVALUATION.md
```

If this were run on real data, the boundary would sit at the LLM API call and would require a data agreement with the vendor and a handling review before Phase 5.

## Architecture decision records

Dates before the repository existed refer to the project charter v1 (2026-09-03) and the pre-repository selection analysis (2026-09-09 and 2026-09-10), which are not included here.

ADR-1 (2026-09-03, confirmed 2026-09-09). Orchestration build surface over a from-scratch Python application. Python only for data generation, FHIR authoring and validation, and the evaluation harness. Reason: value is in workflow design, evaluation, and product judgment, not custom code.

ADR-2 (2026-09-09). Lumbar MRI under L34220 rather than knee arthroplasty. Reason: simpler criteria make a 20-case golden set achievable in four weeks and a 20-second setup possible for a non-healthcare viewer; the commercial variant supplies the policy-divergence cases later.

ADR-3 (2026-09-09). Approve output retained and issued by the system without pre-review; deny output excluded by design. Reason: every rule located restricts denials, delays, and modifications; none restricts automated approval, and automated approval is the industry's stated 2027 target. Mitigations for the two tension points (documentation request as delay; route summary as partial adverse determination) are in the explainability design above. The setting is a Medicare Advantage plan, the payer type that both requires prior authorization for lumbar MRI and must apply the Medicare LCD.

ADR-4 (2026-09-10). Golden set fixed at 20 cases from day one; commercial six-week variant moved to release 2. Reason: in the load test, at 20 hours per week, committing to 20 cases gives a 0.93 to 0.99 probability of deploying inside four weeks, against 0.76 when the 30-case scope is held open until a week-two check. At 16 hours per week the 20-case build is a five-week project, which is why the charter's week-two rule moves the date rather than the case count.

ADR-5 (2026-09-03). No custom Synthea low-back-pain module. Reason: authored episodes are faster and more controllable for 20 cases.

ADR-6 (2026-09-13). No published prior authorization skill, FHIR server, or coverage server reused; the retrieval, adjudication logic, golden set, evaluation harness, and runbook are all original to this project.

ADR-7 (2026-09-14). Demo surface: hosted web endpoint (Cloudflare Worker) plus a single static-page viewer, scoped to the twenty golden-set cases rather than arbitrary bundle intake. Reason: the strongest available evidence of production deployment experience, reusing a Cloudflare deployment pattern already run before, and the only surface that honors the runtime kill switch in RUNBOOK.md, which requires the system to remain available while disabled rather than simply not being invoked. Amends ADR-1: plumbing code is permitted solely for request intake (selecting a known case, not arbitrary upload) and response rendering at the demo surface; the agent's decision logic remains entirely inside the versioned specification, and the endpoint contains no case-specific or criterion-specific conditional logic.
