# Operational Runbook

EDOM Phase 6 artifact. In place before the first user. Holds the deploy and rollback steps, the kill switch, and the final monitoring thresholds.

## Deploy

Deployment runs as the "Deploy demo" workflow, which the owner approves, from main (or from a v* release tag for a code rollback) (ADR-9, ADR-14). It builds the demo's content from that commit (demo/build_demo.py), runs the demo's tests on a local copy, finds or creates the D1 database prior-auth-demo, and uploads the Worker together with its secrets in one version: the demo key (from ANTHROPIC_DEMO_KEY), the live-run passcode (from DEMO_PASSCODE, at least 12 characters), and CHECKLIST_MODE=true. So every deploy is in checklist mode, and new code never runs with approvals on. It then confirms the viewer answers, reports checklist mode with live runs set up, lists all twelve case ids, and refuses a live run without its header and on a held-out case; none of these checks reaches the model. The approve output is enabled only after the release decision is signed, by the "Demo switch" workflow, which refuses unless RELEASE_DECISION.md on main records a Go decision with the owner's typed, dated signature. Smoke test, by the owner after each deploy: open the viewer, confirm all twelve cases are listed and every stored decision shows as routed, then with the passcode run case 01 live and confirm its per-criterion statuses match the final labels (C1 unsupported; C2, C3 and C4 supported), with citations rendering. In checklist mode the routing returned is route; once approvals are on, it must match the final label (approve). The public viewer shows stored decisions, decided again by the fixed rule under the current mode; live runs need the passcode, are capped at 2 a minute and 20 a day across all visitors, pause for everyone after 10 wrong passcodes in ten minutes, and are refused for the held-out cases (08, 10, 12) and for any case whose final labels are not in place.

## Roll back

Run the "Demo switch" workflow with approvals "off" (the owner approves it) for an immediate disable. It changes only the Worker's CHECKLIST_MODE setting, leaving the deployed code as it is, and confirms the viewer reports checklist mode. Confirm case 01 now returns route with its per-criterion statuses and citations. For a code rollback, run "Deploy demo" on the previous release tag (v*); it deploys in checklist mode, so switch approvals on again only if the release decision for that version stands. The previous agent version is the previous release tag in CHANGELOG.md; re-run the case 01 smoke test.

## Kill switch

Condition: any of the following. A false approval observed on any case (monitoring sample, demo, or re-evaluation). A vendor model version change that has not yet been re-evaluated. A change to the policy text that has not yet been routed through the regulation-change process. A prompt-injection success in any observed case.

Action: set the agent to checklist mode (the "Demo switch" workflow with approvals "off"; see Roll back), in which the approve output is disabled and every case returns per-criterion status with citations and is routed to the reviewer. The system remains available; it stops deciding. Record the trip in GOVERNANCE.md (decision log and model inventory state "Suspended"). Checklist mode is the same behavior whether entered by this switch at runtime or shipped permanently under the charter's stop condition; the release rule for it is in EVAL_PLAN.md. The Worker treats any CHECKLIST_MODE other than exactly "false" as checklist mode, so a missing or mistyped setting fails safe, and stored decisions are decided again under the current mode, so the switch covers them too.

Who may trip it: Enlai Weng. Who decides the exit: the same person, with the root cause recorded: design cause returns to ARCHITECTURE.md; defect returns to build; otherwise retire.

Tested: the switch was tripped once on [date] as a test, checklist mode confirmed on case [id], and the trip and exit recorded in the decision log.

## Monitoring plan (final)

Production thresholds, what must stay true after release, distinct from the release thresholds in EVAL_PLAN.md.

| Signal | Threshold | Loop fired | Where recorded |
|---|---|---|---|
| False approval observed | any | Kill switch | GOVERNANCE.md decision log; inventory state Suspended |
| Pend rate on a monitoring sample | more than 10 points from release value | Review; drift loop to build if confirmed | Decision log |
| Citation faithfulness on a monitoring sample | below 90% | Drift loop to build | Decision log |
| Vendor model version change | any | Vendor-update loop: full re-evaluation before continued use | EVALUATION.md maintenance; CHANGELOG.md verification entry |
| Policy text change (L34220 revision or new variant) | any | Regulation-change route: GOVERNANCE.md regime mapping and risk register updated, then ARCHITECTURE.md and EVAL_PLAN.md revisited for affected criteria | Decision log |
| Mislabel found in golden set | any | Dataset-repair loop: DATASHEET.md updated, re-evaluate | DATASHEET.md maintenance table |

Monitoring sample for this portfolio build: the golden set plus any new cases authored after release, re-run on each change to the agent, the model version, or the policy text. There is no live traffic.

## Escalation

Single operator: Enlai Weng,  234715621+enlaiweng@users.noreply.github.com . For a portfolio build this section exists to show the shape; it names one person.

## Adoption note

If this were deployed to a UM team: pilot with one team on lumbar MRI requests only; a fifteen-minute walkthrough of the three outputs and the citation display; a feedback button on the request screen; the audit sample of approvals reviewed weekly for the first month. Metrics that would say adoption is real: reviewer reversal rate on system approvals, override rate on documentation requests, and time from request receipt to decision against the pre-pilot baseline. None of this is measured in this build; it is written so the release has an adoption plan with a shape a program office would recognize.

## Labeling site (outside labelers)

The online labeling site (labeling-site/README.md; ARCHITECTURE.md, ADR-13) is separate from the demo Worker and holds no agent.

- **Deploy or update:** run the "Deploy labeling site" workflow from main and approve it. It needs CLOUDFLARE_API_TOKEN (with D1 Edit), CLOUDFLARE_ACCOUNT_ID, and LABELING_ADMIN_KEY in the release environment. The run's summary gives the address.
- **Invite, assign, replace or turn off a link, reopen a case:** the admin page, `/admin`, signed in with the admin key. Every change is in its activity log.
- **Let someone redo a case:** before they submit, they can click **Clear this case** themselves. After they submit, use **Clear it** for that case on the admin page, with a reason (it starts again from not started), or **Reopen it** to let them change their answers.
- **Redo a case of your own blind labels:** before uploading, click **Clear this case** on the labeling page. After the blind-labels pull request is merged they are locked; changes go in the final labels at settling.
- **Step-by-step setup:** the Claude project's guide `claude/labeling-site-setup-2026-10-20.md` walks through deploying, testing, and inviting, one click at a time.
- **Collect labels:** download submitted labels from the admin page; Claude adds them to the repository through a pull request.
- **If a link leaks:** make a new link for that person on the admin page (the old one stops at once), and check the activity log for sign-ins.
- **If the admin key leaks:** change LABELING_ADMIN_KEY in the release environment and run the deploy workflow again.
- **Remove a person's details on request:** the admin page's "Remove this person's details" (labeling-site/README.md); record it in the decision log.
- **Shut down:** delete the Worker and the D1 database named prior-auth-labeling in the Cloudflare dashboard, after downloading anything to keep.

## Demo path

[Three lines: which case to submit for an approve, which for a documentation request, which for a physician route, and what the viewer should see on screen for each.]
