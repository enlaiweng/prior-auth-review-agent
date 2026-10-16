# Initiative Charter

EDOM Phase 1 commitment. Written before design. Signed by the product owner, Enlai Weng, who holds every decision role on this build; since Amendment 2, Claude, an AI engineering agent, does the engineering work under his review. Amended, not rewritten, if the workflow or the rules change.

Committed on: 2026-09-12. Amended 2026-10-13 (Amendment 1) and 2026-10-14 (Amendment 2), both at the end of this file.

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

In: one policy (Noridian LCD L34220, Lumbar MRI, revision effective October 23, 2025); synthetic patients (Synthea demographics plus authored episodes as FHIR R4 bundles with one clinical note each); a golden set of 12 adjudicated cases (20 in the original charter; Amendment 1); an orchestration build with Python for data generation, FHIR authoring and validation, and the evaluation harness; end-to-end deployment on synthetic data; the documents listed in the README's phase table.

Out: a deny output; real patient data; any second procedure; a custom Synthea disease module; Da Vinci PAS conformance beyond a PAS-shaped intake bundle; a user study.

Release 2, after deployment: a commercial-payer variant requiring six weeks of conservative therapy, written up as a design note that shows how the regulation-change route would handle it, rather than built (Amendment 1; see GOVERNANCE.md, decision log).

## Constraints

Clock: hard stop November 25, 2026 (Amendment 2; December 9 under Amendment 1; originally October 7); may move to December 9 under check 1 below. Hours: about 20 owner hours to the stop under Amendment 2 (10 per week committed originally), dependent on AI usage credit availability. The load test behind this plan (ARCHITECTURE.md, ADR-4) gives a 0.93 to 0.99 probability of deploying inside four weeks at 20 hours per week; at 16 hours per week the same scope is a five-week build. Budget: API and platform credits only. Data: synthetic only, redistributable on GitHub.

## Success measures

Deployed end to end so that a record can be submitted and a routed, cited decision returned, with a runbook in place. On the golden set: zero false approvals on cases adjudicated not approvable; citation faithfulness at or above 95 percent; per-criterion agreement, routing agreement, missing-documentation recall, and abstention behavior reported with error analysis by type; pend rate and estimated reviewer minutes per case published with the estimation method stated. The golden set regenerates bit for bit from the documented seed and protocol; evaluation results reproduce within [n] cases at the pinned model version (the API does not allow changing the temperature on the pinned model, so repeat runs measure the model's own variation; Amendment 2).

## Stop conditions

The golden set is fixed at 12 cases (Amendment 1; 20 in the original charter) and does not shrink further; check 1 acts on the clock and on evaluation depth, not on the case count.

Check 1, October 28, 2026 (redefined by Amendment 2): if the final labels for all 12 cases are not in place, or the projected total exceeds the remaining budget, move the stop date to December 9. If the stop date cannot move, drop the paired fairness checks and the no-notes run before touching the 12, and record the cut in the decision log. Smoke run and check 2, November 4, 2026 (Amendment 2; formerly November 11 and November 25): if any false approval survives two prompt iterations on the 9 cases that are not held out, or citation faithfulness cannot be pushed above 90 percent, disable the approve output and ship in checklist mode (RUNBOOK.md), under the release rule for that mode in EVAL_PLAN.md; and if the deployed path, running in checklist mode, does not yet accept a record and return a decision, stop adding evaluation depth and finish deployment. At release: if a held-out case shows a false approval in the release evaluation, the frozen agent is not changed, and the release goes out in checklist mode under the same rule.

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

## Amendments

Amendment 1, 2026-10-13. The golden set goes from 20 cases to 12 (cases 01 to 10, 12, and 15 from the original allocation). The three held-out cases written in a different note style are replaced by three ordinary cases that are never used for prompt tuning. The demo viewer's audit list, the separate-model output audit, and the release 2 build are dropped; release 2 becomes a design note. The stop date moves to December 9, 2026, with December 16 as the fallback, and the stop-condition checks move to October 28, November 11, and November 25. Reason: the committed budget is 10 hours per week against a plan written for 20, and after a four-week pause the 20-case scope was about 90 hours from release at the observed pace, against about 74 for 12 cases. No case had been authored, so no label or result is affected. The twelve still cover every outcome, a documentation gap for each of C2, C3, and C4, five adversarial cases including two instruction-bearing notes, and both paired fairness checks. Recorded in GOVERNANCE.md (decision log, 2026-10-13) and ARCHITECTURE.md (ADR-8).

Amendment 2, 2026-10-14. Who builds and who decides: Claude, an AI engineering agent, writes the cases, notes, agent, scoring script, deployment code, and first drafts of documents; every change reaches the main branch only through a pull request Enlai Weng approves. Enlai writes the answer key, settles disagreements, approves every run that uses the release budget, creates the freeze and release tags, and signs each gate. How the answer key is made: Claude's intended answers are committed as an encrypted file before any label exists, and the key is published afterward; Enlai labels all 12 cases without seeing the intended answers or any other reader's labels (blind at the criterion level, since he knows each case's designed outcome from EVAL_PLAN.md); a model from another company (Gemini, through its API) labels the same cases separately; Enlai settles every disagreement against the policy text. This comparison replaces the seven-day self-relabel. Optionally, a utilization management nurse labels three or four cases the same way. Held-out cases 08, 10, and 12 are written and locked before any version of the agent exists, their notes are restyled in another model's writing style, and they are never used for tuning. Model runs, evaluation runs, and deployment run as GitHub workflows with protected keys (ARCHITECTURE.md, ADR-9). The vendor-update run moves to claude-sonnet-5-5. The public demo shows stored decisions; live runs sit behind a passcode. Dates: check 1 stays October 28 and is redefined; the smoke run and check 2 move to November 4; the stop moves to November 25, 2026, with December 9 as the fallback. Reason: the split cuts the owner's remaining hours from about 74 to about 20 while separating case authorship from labeling and adding a reader from another company. No case, label, or prompt existed when this amendment was written. Recorded in GOVERNANCE.md (decision log, 2026-10-14) and ARCHITECTURE.md (ADR-9).

Signed: Enlai Weng, 2026-09-12. Amendment 1 signed: Enlai Weng, 2026-10-13. Amendment 2 signed: Enlai Weng, 2026-10-15
