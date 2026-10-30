# Release Decision Record

EDOM Phase 5 commitment. Half a page. Signed against the thresholds in EVAL_PLAN.md and the stop conditions in CHARTER.md before the approve output is enabled (the system is first deployed in checklist mode; Amendment 2).

## Decision

[Go / No-go] for release [1.0], agent version [agent-x.y] (spec [first 12 characters of spec_sha256]), evaluated on golden set [1.0] on [date]. The version and spec are the ones the demo's status shows. Evaluation report: EVALUATION.md.

## Thresholds

Hard gate (zero false approvals): [met / not met]. Citation faithfulness at or above 95 percent: [met / not met]. Gated metrics below threshold, with explanation: [none / list]. Stop conditions from the charter: [none triggered / which and what was done].

## Security scan section

Secrets and dependency scan of the repository: [clean / findings and disposition]. Prompt-injection test (instruction-bearing notes): [n of n passed]. No real data present: confirmed.

## Explainability acceptance section

Checked against the explainability design in ARCHITECTURE.md: per-criterion status shown [yes/no]; supporting record element cited by resource and identifier [yes/no]; policy text quoted [yes/no]; named gap on documentation requests [yes/no]; confidence tier shown [yes/no]; override path present [yes/no]; physician-route output reads as a case summary, not a denial recommendation [yes/no].

## Independence statement

Claude, an AI engineering agent, built the system and wrote the cases under Enlai Weng's review; Enlai labeled the answer key, settled disagreements, approved every change and every run on the release budget, and signs this record. EDOM recommends that the person who built a model not sign its validation; here builder and signer are different, but the builder also tuned the agent and wrote the cases. Independence was approximated, not achieved, by: intended answers locked before labeling; the owner's blind labels; a third reader from another company, [model and version], agreement [ ]; [a utilization management nurse on n cases, agreement [ ] / no nurse check]; held-out cases locked before any version of the agent existed and never used for tuning. Remaining gaps: the owner knew each case's designed outcome, two of the three readers are AI models, and the agent's tuner wrote the held-out cases. These gaps are recorded rather than hidden.

## Conditions attached to the release

Monitoring thresholds and the kill switch in RUNBOOK.md are in place before the first demo user. The vendor-update re-evaluation runs within 7 days of release. Release 2 (commercial variant) is a design note, not a release; building it would require a new record.

Signed: [the owner types his name and the date, written YYYY-MM-DD, here before merging].
