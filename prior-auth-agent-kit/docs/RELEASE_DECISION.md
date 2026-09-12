# Release Decision Record

EDOM Phase 5 commitment. Half a page. Signed against the thresholds in EVAL_PLAN.md and the stop conditions in CHARTER.md before anything is deployed.

## Decision

[Go / No-go] for release [1.0], agent version [tag], evaluated on golden set [1.0] on [date]. Evaluation report: EVALUATION.md.

## Thresholds

Hard gate (zero false approvals): [met / not met]. Citation faithfulness at or above 95 percent: [met / not met]. Gated metrics below threshold, with explanation: [none / list]. Stop conditions from the charter: [none triggered / which and what was done].

## Security scan section

Secrets and dependency scan of the repository: [clean / findings and disposition]. Prompt-injection test (instruction-bearing notes): [n of n passed]. No real data present: confirmed.

## Explainability acceptance section

Checked against the explainability design in ARCHITECTURE.md: per-criterion status shown [yes/no]; supporting record element cited by resource and identifier [yes/no]; policy text quoted [yes/no]; named gap on documentation requests [yes/no]; confidence tier shown [yes/no]; override path present [yes/no]; physician-route output reads as a case summary, not a denial recommendation [yes/no].

## Independence statement

One person built, adjudicated, and evaluated this system and holds every role in the operating model's RACI. EDOM recommends that the person who built a model not sign its validation. Independence was approximated, not achieved, by: a time-separated second adjudication pass (agreement recorded in DATASHEET.md) and an adversarial audit of the agent's outputs run with a separate model and prompt on [date], findings: [summary]. This gap is recorded rather than hidden.

## Conditions attached to the release

Monitoring thresholds and the kill switch in RUNBOOK.md are in place before the first demo user. The vendor-update re-evaluation runs within [7] days of release. Release 2 (commercial variant) requires a new record.

Signed: [name, date].
