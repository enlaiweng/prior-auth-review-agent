# EDOM Abridged: Minimum Viable Documentation for the Prior Auth Review Agent

Prepared 2026-09-10. This is EDOM v3.1 cut down to what one person needs to deliver this project and what a hiring manager needs to see that the method was run. It is derived from the paper's solo bundle (Appendix D) and the load test (Section 2.14, Test 3), then customized: every template in this folder is pre-filled with what has already been decided, and brackets mark what the build will supply.

## The set: nine documents and a README

| # | File | Phase | Written | Timebox | Why it is kept |
|---|---|---|---|---|---|
| 1 | docs/CHARTER.md | 1 | Before design (day 1) | 1.5 h | Holds the authority statement, which is the project's thesis, and the stop conditions, which are the plan's safety valve. The first thing a payer reviewer reads. |
| 2 | docs/ARCHITECTURE.md | 2 | Before build | 1 h | Integration decision, explainability design, data boundary, and five decisions already recorded as ADRs (a sixth is conditional on reusing a published component). Answers "why orchestration" and "why not a chatbot." |
| 3 | docs/EVAL_PLAN.md | 3 | Before build | 1.5 h | Metrics and thresholds set before the first run. This is what separates the repository from the hobby projects. Frontier-lab readers start here. |
| 4 | docs/DATASHEET.md | 3 | With the golden set | 1 h plus authoring | Provenance, protocol, second-pass agreement, limitations. Without it the numbers cannot be trusted or repaired. |
| 5 | docs/RELEASE_DECISION.md | 5 | Before deployment | 0.5 h | Half a page. The go/no-go signed against the plan, with the security, explainability, and independence statements. The document that makes "taken to production" a defensible claim. |
| 6 | docs/RUNBOOK.md | 6 | Before the first user | 1 h | Deploy, roll back, kill switch to checklist mode, monitoring thresholds, and a one-paragraph adoption note. Proves Phase 6 and Phase 7 exist. |
| 7 | docs/EVALUATION.md | 5 | After evaluation; may follow deployment by a week | 3 h | Results, error analysis by type, adversarial results, and the model card in CHAI layout. The document a clinical AI company reads most closely. |
| 8 | docs/GOVERNANCE.md | Spine | Opened day 1, maintained | 1.5 h total | Regime mapping (already filled, eight rows), risk register (ten rows seeded), decision log (five entries already, the week-two entry pre-dated), model inventory. A dated decision log is the single best evidence of judgment. |
| 9 | docs/CHANGELOG.md | 4, 6, 7 | Continuously | 0.5 h total | Version log for prompts and models, change control records, verification entries for loops. Cheap, and the audit trail. |
| 10 | README.md | All | Skeleton day 1, numbers last | 1.5 h | The hiring manager's first and often only screen: the constraint, the results table, the demo, the phase map, the regulatory paragraph, the limits. |

About 13 hours of documentation in total. Files 1 through 6 (about 6.5 hours) are on the critical path: the paper's five build-critical documents (charter, eval plan, datasheet, release decision, runbook) plus the architecture file, which the paper's solo bundle also writes once before build. That matches the paper's load test, where the lean build-critical set is the difference between finishing and not at 16 to 20 hours per week.

## The order, and why it cannot be changed

Charter before design. Eval plan and datasheet before build. Release decision before deployment. Runbook before the first user. Evaluation report, governance updates, and README numbers may follow deployment by up to a week. A repository that has all ten files but wrote them in the wrong order has the binder and not the method; the dates in the decision log and changelog are what show the order was kept.

## What was cut from full EDOM, and why it is safe to cut

Cut as separate files: the Adoption Plan and the User Transparency Notice (the transparency content is the README section "What it is for and what it may not decide"; the adoption plan is one paragraph in RUNBOOK.md, written in the conditional, because a full plan for a tool with no users would be theater but a release with no adoption shape at all fails the paper's Phase 6 exit). The Threat Model as a document (the one real threat, instruction-bearing notes, is a test in the eval plan and a row in the risk register). The Validation Plan and Validation Report (not a regulated deployment). The RACI (one person; stated in one sentence in GOVERNANCE.md). Retrospective Record, Quarterly Governance Review Record, Retirement Record (Extended tier; enterprise only). The Change Control Plan as a PCCP envelope (no regulator). Separate Workflow Map, Regime Mapping, Risk Tier Assessment, Explainability Acceptance Record, Security Scan Report, Loop Trigger Decision documents (each is now a section of one of the ten files, exactly as v3.1's solo bundle folds them).

Kept even though it is uncomfortable: the independence statement in the release decision. One person cannot provide effective challenge to their own work. Saying so, and describing the time-separated second pass and the separate-model adversarial audit that approximate it, reads as maturity. Omitting it reads as not knowing the problem exists.

## What a hiring manager reads, by audience

A payer or utilization management leader opens the README, reads the constraint and the regulatory paragraph, then goes to GOVERNANCE.md for the regime mapping and to RUNBOOK.md for the kill switch. They are checking whether you understand their world.

A clinical AI company opens the README results table, then EVAL_PLAN.md to see whether thresholds were set before the run, then EVALUATION.md's error analysis and DATASHEET.md's agreement rate. They are checking evaluation discipline.

A frontier-lab technical program manager opens EVAL_PLAN.md first, then the decision log in GOVERNANCE.md, then the CHANGELOG to see the vendor-update loop actually ran. They are checking whether the process is real and whether you can explain asymmetric error costs without healthcare vocabulary.

Put the results table and the constraint in the first screen of the README. Everything else is one click away.

## What not to add

Do not add a document because a framework names it. The test for any addition is the paper's own: does it change a decision? If the folder grows past these ten files before release 2, stop and ask which decision the eleventh file changed.

## Placeholder convention

Square brackets mark values the build supplies (dates of commits, results, model versions, run counts). Values already decided are written plainly: the 20-case set and its 8/6/6 split, the thresholds, the stop dates (October 7, with October 14 as the fallback), the week-two check on September 23, the author's name. If a bracket seems to hold a decision rather than a build output, it is a mistake; make the decision and remove the bracket.

## How to use this folder

Copy `README.md` and `docs/` into the repository root; this guide stays outside the repository. Fill brackets as the build supplies them. Leave "not applicable" fields in the model card in place rather than deleting them. Every dated entry in GOVERNANCE.md and CHANGELOG.md should be written on the day it happens, not reconstructed at the end.

## Verification record

Checked 2026-09-10 against EDOM v3.1 Appendix D (every Core artifact has a home in one of the ten files; the mapping is in Part 3 of the combined document), against the Stage 1 Pass 2 report and the EDOM feasibility run (dates, thresholds, probabilities, regulatory claims), and by an independent reviewer who had not written the templates. Defects found and fixed in that pass: the decision log inverted the switching rule; ADR-4's probabilities lacked their 20-hour condition; the week-two stop condition still cut cases after the 20-case set was fixed; the golden set could be read as 20 or 25; approve ownership differed between the charter and the README; the payer type (Medicare Advantage, which both requires prior authorization for lumbar MRI and must apply the Medicare LCD) was unstated; WISeR read as a binding rule rather than an analog; "same numbers" over-claimed reproducibility for nondeterministic model output; per-criterion agreement was missing from the README table; the L34220 revision date and contractor were absent.
