# Operational Runbook

EDOM Phase 6 artifact. In place before the first user. Holds the deploy and rollback steps, the kill switch, and the final monitoring thresholds.

## Deploy

[Steps, three to eight lines: environment, secrets, start the agent service or orchestration, start the demo surface, smoke test with case 01.]

## Roll back

[Steps: stop the current version, restore the previous agent version tag from CHANGELOG.md, re-run the smoke test.] Rollback target is always the last version with a signed release decision.

## Kill switch

Condition: any of the following. A false approval observed on any case (monitoring sample, demo, or re-evaluation). A vendor model version change that has not yet been re-evaluated. A change to the policy text that has not yet been routed through the regulation-change process. A prompt-injection success in any observed case.

Action: set the agent to checklist mode, in which the approve output is disabled and every case returns per-criterion status with citations and is routed to the reviewer. The system remains available; it stops deciding. Record the trip in GOVERNANCE.md (decision log and model inventory state "Suspended"). Checklist mode is the same behavior whether entered by this switch at runtime or shipped permanently under the charter's stop condition; the release rule for it is in EVAL_PLAN.md.

Who may trip it: Enlai Weng. Who decides the exit: the same person, with the root cause recorded: design cause returns to ARCHITECTURE.md; defect returns to build; otherwise retire.

Tested: the switch was tripped once on [date] as a test, checklist mode confirmed on case [id], and the trip and exit recorded in the decision log.

## Monitoring plan (final)

Production thresholds, what must stay true after release, distinct from the release thresholds in EVAL_PLAN.md.

| Signal | Threshold | Loop fired | Where recorded |
|---|---|---|---|
| False approval observed | any | Kill switch | GOVERNANCE.md decision log; inventory state Suspended |
| Pend rate on a monitoring sample | more than [10] points from release value | Review; drift loop to build if confirmed | Decision log |
| Citation faithfulness on a monitoring sample | below 90% | Drift loop to build | Decision log |
| Vendor model version change | any | Vendor-update loop: full re-evaluation before continued use | EVALUATION.md maintenance; CHANGELOG.md verification entry |
| Policy text change (L34220 revision or new variant) | any | Regulation-change route: GOVERNANCE.md regime mapping and risk register updated, then ARCHITECTURE.md and EVAL_PLAN.md revisited for affected criteria | Decision log |
| Mislabel found in golden set | any | Dataset-repair loop: DATASHEET.md updated, re-evaluate | DATASHEET.md maintenance table |

Monitoring sample for this portfolio build: the golden set plus any new cases authored after release, re-run on each change to the agent, the model version, or the policy text. There is no live traffic.

## Escalation

Single operator: Enlai Weng,  234715621+enlaiweng@users.noreply.github.com . For a portfolio build this section exists to show the shape; it names one person.

## Adoption note

If this were deployed to a UM team: pilot with one team on lumbar MRI requests only; a fifteen-minute walkthrough of the three outputs and the citation display; a feedback button on the request screen; the audit sample of approvals reviewed weekly for the first month. Metrics that would say adoption is real: reviewer reversal rate on system approvals, override rate on documentation requests, and time from request receipt to decision against the pre-pilot baseline. None of this is measured in this build; it is written so the release has an adoption plan with a shape a program office would recognize.

## Demo path

[Three lines: which case to submit for an approve, which for a documentation request, which for a physician route, and what the viewer should see on screen for each.]
