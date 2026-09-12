# Changelog

Three registers in one file, kept from the first build onward: the version log for prompts, retrieval configuration, and model versions (EDOM Phase 4); change control records and release notes (Phase 6); and verification entries from Phase 7 loops. One dated line per change. If a reader cannot reconstruct what ran on a given date from this file, it is incomplete.

## Provenance convention

Code, prompts, and tests in this repository were produced with AI assistance under human direction. Commits that contain AI-generated code or prompt text carry the trailer `AI-assisted: yes`; the evaluation harness and its tests were reviewed line by line by the author before the first release. This is the Phase 4 provenance tag for a one-person build, where commits stand in for pull requests.

## Version log (prompts, retrieval, model)

| Date | Version | What changed | Why | Evaluation run |
|---|---|---|---|---|
| [date] | agent-0.1 | Initial agent instructions, decision schema, retrieval over L34220 by criterion | Baseline | Run 1 |
| [date] | agent-0.2 | [e.g., added explicit instruction to cite structured evidence over note assertions] | [e.g., two instruction-bearing notes changed routing in run 1] | Run 2 |
| [date] | model: [vendor model version] | Pinned model version for release 1.0 | Reproducibility | |

## Change control records

| Date | Release | What changed | Approval | Rollback target | Notes |
|---|---|---|---|---|---|
| [date] | 1.0 | First deployment: agent-[x], golden set 1.0, demo surface | RELEASE_DECISION.md signed [date] | none (first release) | Runbook and monitoring thresholds in place before first demo |
| [date] | 1.0.1 | [hotfix, if any: scope limited to the fix; re-evaluated on affected cases] | | 1.0 | |
| [date] | 2.0 | Commercial six-week variant added via the regulation-change route | New release decision record | 1.0 | See GOVERNANCE.md decision log |

## Verification entries (loops that did not require a release)

| Date | Loop | What was checked | Outcome |
|---|---|---|---|
| [date] | Vendor update | Full golden set on model [second version] | [Passed: version log, EVALUATION.md maintenance, model card, and inventory updated; no release / Failed: returned to build as agent-x.y] |
| [date] | Dataset repair | Case [id] relabeled: [reason] | DATASHEET.md 1.1; re-evaluated |

## Release notes

### 1.0, [date]

First release. Three outputs, no deny. Evaluated on 20 cases; results in the README. Known limitations in EVALUATION.md.

### 2.0, [date]

Commercial variant (six weeks of conservative therapy) added as a second policy via the regulation-change route. Policy-divergence cases: [n] cases approvable under L34220 and not under the commercial variant; results: [routing and citation results on those cases].
