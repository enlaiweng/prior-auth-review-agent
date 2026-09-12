# Initiative Charter

EDOM Phase 1 commitment. Written before design. Signed by the product owner, Enlai Weng, who holds every role on this build. Amended, not rewritten, if the workflow or the rules change.

Committed on: Sept 12, 2026.

## Purpose

Build and deploy a small, rigorously evaluated prior authorization review agent as evidence that AI can be made useful and trustworthy in a workflow modeled on a real payer's utilization review. The artifact is a career portfolio project, not a commercial product, and it runs on synthetic data only.

## Problem

A utilization management nurse at a Medicare Advantage plan reviewing a lumbar MRI prior authorization request spends most of the review hunting the chart for evidence against each coverage criterion, under a regulatory clock. The evidence is scattered across structured data and free-text notes. The criteria are public text.

Why a Medicare Advantage plan: traditional Medicare fee-for-service does not generally require prior authorization for lumbar MRI. Medicare Advantage plans do, and under 42 CFR 422.101(b) they must apply traditional Medicare coverage criteria, including the Medicare Administrative Contractor's Local Coverage Determination. The CMS-0057-F decision clocks (72 hours expedited, 7 calendar days standard, operational from January 1, 2026) bind MA organizations. So an MA plan's reviewer applying Noridian's LCD L34220 under those clocks is the coherent setting, and it is the one this project models.

## Users and population

Primary user: the MA plan's utilization management nurse reviewer. Secondary: the physician or other appropriate health care professional who receives routed cases (42 CFR 422.566(d) requires that level of review for adverse medical necessity determinations; this project routes to a physician). Population: adults with a lumbar MRI request under L34220. Pediatric cases are out of scope.

## Intended Use and Authority Statement

The system may output exactly one of three results for a request:

1. Approve, when every applicable criterion is supported by cited evidence in the record.
2. Request specific missing documentation, naming the criterion the gap belongs to and the record element that would close it.
3. Route to physician review, with a neutral summary of which criteria are met, unmet, or undeterminable, and the citations for each.

The system may never: deny; recommend denial; issue an approval without a citation for every applicable criterion; stop, pause, or extend a regulatory decision clock; let a documentation request lapse into a deemed adverse determination (an unanswered request is routed to physician review before the clock expires); be applied to a policy or procedure it was not evaluated against; be run on real patient data without a data agreement and a fresh evaluation.

Who owns each output. Approve is issued by the system without pre-review; the UM program owns it through a post-issue audit sample and through the kill switch, which withdraws the system's authority to approve. The documentation request is issued by the system and confirmed by the reviewer before it goes to the provider. Every routed case is decided by the physician reviewer. The system decides nothing that a person cannot see, audit, and reverse.

## Scope

In: one policy (Noridian LCD L34220, Lumbar MRI, revision effective October 23, 2025); synthetic patients (Synthea demographics plus authored episodes as FHIR R4 bundles with one clinical note each); a golden set of 20 adjudicated cases; an orchestration build with Python for data generation, FHIR authoring and validation, and the evaluation harness; end-to-end deployment on synthetic data; the documents listed in the README's phase table.

Out: a deny output; real patient data; any second procedure; a custom Synthea disease module; Da Vinci PAS conformance beyond a PAS-shaped intake bundle; a user study.

Release 2, after deployment: a commercial-payer variant requiring six weeks of conservative therapy, built as a demonstration of the regulation-change route (see GOVERNANCE.md, decision log).

## Constraints

Clock: hard stop October 7, 2026, about four weeks from charter signature; may move to October 14 under the week-two rule below. Hours: 10 per week, dependent on AI usage credit availability. The load test behind this plan (ARCHITECTURE.md, ADR-4) gives a 0.93 to 0.99 probability of deploying inside four weeks at 20 hours per week; at 16 hours per week the same scope is a five-week build. Budget: API and platform credits only. Data: synthetic only, redistributable on GitHub.

## Success measures

Deployed end to end so that a record can be submitted and a routed, cited decision returned, with a runbook in place. On the golden set: zero false approvals on cases adjudicated not approvable; citation faithfulness at or above 95 percent; per-criterion agreement, routing agreement, missing-documentation recall, and abstention behavior reported with error analysis by type; pend rate and estimated reviewer minutes per case published with the estimation method stated. The golden set regenerates bit for bit from the documented seed and protocol; evaluation results reproduce within [n] cases at the pinned model version and temperature.

## Stop conditions

The golden set is fixed at 20 cases and does not shrink; the week-two rule acts on the clock and on evaluation depth, not on the case count.

Week two, September 23, 2026: if authoring is running above 90 minutes per case after the first five cases, or the projected total exceeds the remaining budget, move the stop date to October 14. If the stop date cannot move, drop the held-out note-style cases and the paired fairness checks before touching the 20, and record the cut in the decision log. Also by week two: if any false approval survives two prompt iterations on the first fifteen adjudicated cases, or citation faithfulness cannot be pushed above 90 percent, disable the approve output and ship in checklist mode (RUNBOOK.md), under the release rule for that mode in EVAL_PLAN.md. Week three, September 30: if the deployed path does not yet accept a record and return a decision, stop adding evaluation depth and finish deployment.

## Risk tier and regimes

Risk tier: moderate. The design removes the highest-harm output (denial); remaining harms are a false approval (payer cost, no patient harm), an unwarranted documentation request (delay), and reviewer over-reliance. Regimes that apply and the design choice answering each are in GOVERNANCE.md; the short list is CMS-0057-F, CMS Medicare Advantage guidance on algorithms (42 CFR 422.566(d) and the February 2024 FAQ), California SB 1120, Texas SB 815, and HHS OCR Section 1557, with the CMS WISeR model as the closest federal analog.

## Workflow map

Sources: CMS-0057-F for the decision clocks and denial-reason requirement; the CMS WISeR operational guide as a published description of a technology-assisted review path (an analog: WISeR covers traditional Medicare services that do not include lumbar MRI); [optional: one conversation with a UM nurse from the author's network, date]. Decision point: the moment the nurse opens the request in her worklist with the chart attached. Tools in use today: the payer's UM platform, the attached clinical documentation, the coverage policy text. Friction: criterion-by-criterion evidence search across structured data and notes under a clock; documentation requests that do not name what is missing; physician escalations without a prepared summary.

```
Provider submits request with documentation
        |
        v
UM nurse's worklist  <-- decision point; agent output appears here
        |
        +--> criteria fully supported --> approve issued; audit sample later
        +--> a named gap --> documentation request (reviewer confirms; clock continues;
        |                     unanswered before the clock expires --> physician review)
        +--> anything else --> physician reviewer with case summary
```

## Model card, opened

Intended use, users, population, and out-of-scope uses as stated above. Completed in EVALUATION.md after evaluation.

Signed: Enlai Weng, 9/12/2026.
