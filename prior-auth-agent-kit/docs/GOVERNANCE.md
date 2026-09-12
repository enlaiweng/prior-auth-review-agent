# Governance

The EDOM governance spine in one file: regime mapping, risk register, decision log, model inventory entry, and the governance paragraph. Opened on day one, maintained throughout. A register updated once is a form; dated entries are the evidence.

## Governance paragraph

One person, [name], holds every role in this build, including the ones EDOM keeps separate (engineering lead, evaluation lead, compliance and risk). The line may be stopped by that person under the kill switch conditions in RUNBOOK.md. There is no quarterly review; the equivalent is the release 2 decision.

## Regime mapping

Which rules bear on an AI tool in prior authorization review at a Medicare Advantage plan, and the design choice in this project that answers each. Checked 2026-09-09; sources in the last section.

| Rule | What it requires | Design choice that answers it |
|---|---|---|
| 42 CFR 422.101(b) (Medicare Advantage coverage criteria) | MA plans must apply traditional Medicare coverage criteria, including the MAC's LCD | The criteria set is Noridian's L34220 (revision effective Oct 23, 2025), quoted and cited per criterion |
| CMS-0057-F (Interoperability and Prior Authorization final rule; operational provisions effective Jan 1, 2026; binds MA organizations among others) | 72-hour expedited and 7-day standard decision clocks; a specific reason for every denial | The agent never denies; documentation requests name the specific criterion gap and do not stop the clock; an unanswered request is routed to physician review before the clock expires |
| CMS Medicare Advantage guidance (Feb 2024 FAQ; 42 CFR 422.566(d)) | Algorithms may assist; adverse medical-necessity determinations must be reviewed by a physician or other appropriate health care professional; decisions must rest on the individual record, not population data | No deny output; every routed case goes to a physician reviewer with the record attached; the agent reasons only over the individual bundle and note |
| CMS WISeR model (Jan 2026 to 2031, six states; traditional Medicare, listed services that do not include lumbar MRI). Closest federal analog, not a binding rule for this setting | Technology-assisted review; clinician review required for non-affirmations, not affirmations | Same posture adopted: approvals may be automated, everything else is human |
| California SB 1120 (effective Jan 2025) | AI may not deny, delay, or modify care on medical necessity grounds; determination by a licensed physician; individual clinical data | No deny; documentation requests tied to a named criterion so they are not a reflexive delay; individual data only |
| Texas SB 815 (plans from Jan 1, 2026) | Automated decision systems may not make adverse determinations wholly or partly; covers systems that suggest or recommend | Physician-route output is a neutral case summary, never a recommendation to deny |
| HHS OCR Section 1557, 45 CFR 92.210 (compliance date May 1, 2025) | Reasonable efforts to identify and mitigate discrimination risk in patient care decision support tools used by covered entities. Treated as in scope here out of caution: a payer's utilization review tool influences access to a covered service | Paired checks on sex and race and a written statement of what synthetic data cannot test (EVAL_PLAN.md) |
| HIPAA | Protection of PHI | No real data; boundary drawn in ARCHITECTURE.md for the record |

Not applicable to this build, stated so a reader does not look for them: ONC HTI-1 (binds certified EHR developers; this tool does not run inside certified health IT, though the model card follows the CHAI layout that satisfies HTI-1's attributes); FDA device regulation (payer administrative decision support, not a device); EU AI Act (no EU deployment).

## Risk register

Seeded from the NIST AI 600-1 generative AI risk categories that apply. Owner is [name] on every row. Status and date change as the build proceeds.

| ID | Risk | Category (NIST 600-1) | Mitigation | Status | Date |
|---|---|---|---|---|---|
| R1 | Agent approves a case that does not meet criteria (false approval); approvals are issued without pre-review, so this is the residual harm class | Confabulation | Hard gate of zero false approvals; post-issue audit sample; kill switch to checklist mode on any observed instance | Open | |
| R2 | Agent cites policy text that is not in the policy | Confabulation; information integrity | Citation faithfulness check against the source text in the harness; 95% release threshold | Open | |
| R3 | Instruction-like text in a clinical note changes the output | Information security (prompt injection) | Instruction-bearing notes in the adversarial set; pass condition is no change in routing or citations | Open | |
| R4 | Physician reviewer over-relies on the agent's summary | Human-AI configuration | Route output written as a case summary with the record attached; override recorded | Open | |
| R5 | Documentation request functions as a delay | Human-AI configuration; regulatory | Every request names the criterion and the record element; clock not stopped; turnaround logged | Open | |
| R6 | Output differs by a protected attribute | Harmful bias | Paired-case check; written statement of what cannot be tested on synthetic data | Open | |
| R7 | Vendor changes the model underneath the agent | Value chain and component integration | Version log; full re-evaluation on any version change before continued use | Open | |
| R8 | Golden set mislabeled or too easy | Information integrity | Time-separated second pass with agreement recorded; held-out note-style cases; dataset-repair loop | Open | |
| R9 | Golden set authoring consumes the clock | Delivery | 20 cases fixed from day one; week-two check on minutes per case; the rule moves the stop date or trims evaluation depth, never the 20 cases | Open | |
| R10 | Build reads as configuration of a published skill rather than original work | Credibility | ADR-6 names any reused component; README puts golden set, evaluation, and runbook first | Open | |

## Decision log

Decisions that are not architecture (those are ADRs in ARCHITECTURE.md). Loop trigger decisions from Phase 7 are typed entries here. Entries dated before the repository existed refer to the project charter v1 and the pre-repository selection analysis, which are not included here.

| Date | Decision | Type | Reason | Reference |
|---|---|---|---|---|
| 2026-09-03 | Chose this project over an alternative portfolio project | Scope | Healthcare and payer relevance; answers the production question | Charter v1 |
| 2026-09-09 | Selection stress test: this concept kept against six alternatives; a blind run with the concept withheld produced it independently | Scope | Highest weighted score at both hour budgets; the switching rule required a challenger to lead by 1.0 point and the closest was 0.65 behind | Selection analysis |
| 2026-09-09 | Approve output retained and issued by the system without pre-review, after the regulatory check | Design authority | No rule located restricts automated approval; two tension points mitigated by design | Regime mapping above |
| 2026-09-10 | Golden set fixed at 20 cases; commercial variant moved to release 2 | Scope cut | At 20 hours per week, completion probability 0.93 to 0.99 versus 0.76 with the 30-case scope held open | Load test; ADR-4 |
| 2026-09-10 | Vendor-update re-evaluation planned as a named run | Loop (planned) | Cheapest demonstrated Phase 7 loop | EVAL_PLAN.md |
| 2026-09-10 | Repository created; hours committed: [X] per week; models: [primary id], [second id]; ADR-6 answer: [ ] | Scope | Sets the hours assumption the week-two check tests against; pins the versions the version log tracks | ARCHITECTURE.md |
| 2026-09-10 | Charter signed; authority statement final | Gate | Phase 1 exit; no Phase 2 work before this commit | CHARTER.md |
| 2026-09-11 | Demo surface chosen: [option]; ADR-1 [amended / unchanged] | Design authority | [ ] | ARCHITECTURE.md ADR-7 |
| 2026-09-11 | Eval plan committed; thresholds fixed; criterion inventory verified against L34220 rev. 2025-10-23 | Gate | Phase 3 commitment precedes any agent work | EVAL_PLAN.md |
| 2026-09-15 | First five cases timed: [t1..t5] minutes, average [a] | Scope | Calibration against the 40 to 100 minute assumption | data/golden/timing.csv |
| 2026-09-16 | Week 1: [n] hours against 20; seven cases authored | Scope | Weekly cadence | plan |
| 2026-09-23 | Week-two check: minutes per case [x]; projected total [y] against budget [z]; smoke run on cases 1-15: [false approvals: none / n]; action: [none / stop date moved to Oct 14 / held-out and paired cases dropped / checklist mode] | Stop condition | | CHARTER.md |
| 2026-09-30 | Week-three check: deployed path accepts a record [yes/no]; release decision signed [yes/no]; action: [none / evaluation depth deferred to week 5 / finish deployment first] | Stop condition | | CHARTER.md |
| [date] | Threshold changes, if any, with reason | Threshold | | EVAL_PLAN.md |
| [date] | Release 2 (six-week commercial variant): regime mapping updated with the variant policy; routed to ARCHITECTURE.md and EVAL_PLAN.md for affected criteria; authority statement unchanged | Loop: regulation-change route | Demonstrates the route on a real policy difference | |
| [date] | Vendor-update loop: second model version [second model id] evaluated; [passed, verification entry only / failed, returned to build] | Loop: vendor update | | EVALUATION.md maintenance |

## Model inventory entry

| Field | Value |
|---|---|
| Feature | Prior Auth Review Agent |
| Owner | [name] |
| Risk tier | Moderate (CHARTER.md) |
| Setting | Medicare Advantage utilization review, lumbar MRI, Noridian LCD L34220 (rev. 2025-10-23) |
| Foundation model and version | [vendor, model, version]; re-evaluated on [second version] |
| Lifecycle state | [In development / Released 1.0 on date / Suspended / Retired] |
| Last evaluation | [date], EVALUATION.md |
| Kill switch owner | [name] |

## Sources for the regime mapping (checked 2026-09-09)

CMS-0057-F fact sheet, https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f. CMS HPMS FAQ on coverage criteria and utilization management, February 6, 2024, https://www.cms.gov/files/document/hpms-memo-faq-coverage-criteria-and-utilization-management-020604pdf.pdf. WISeR model, https://www.cms.gov/priorities/innovation/innovation-models/wiser, and operational guide, https://www.cms.gov/priorities/innovation/files/wiser-provider-supplier-guide.pdf. California SB 1120, https://legiscan.com/CA/text/SB1120/id/3023335. Texas SB 815, https://legiscan.com/TX/text/SB815/2025. Holland & Knight state review, May 2026, https://www.hklaw.com/en/insights/publications/2026/05/states-continue-efforts-to-regulate-ai-in-healthcare. KFF overview, https://www.kff.org/patient-consumer-protections/regulation-of-ai-in-prior-authorization-and-claims-review-a-look-at-federal-and-state-consumer-protections/. LCD L34220, https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=34220.
