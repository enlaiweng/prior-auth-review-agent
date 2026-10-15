# Changelog

Three registers in one file, kept from the first build onward: the version log for prompts, retrieval configuration, and model versions (EDOM Phase 4); change control records and release notes (Phase 6); and verification entries from Phase 7 loops. One dated line per change. If a reader cannot reconstruct what ran on a given date from this file, it is incomplete.

## Provenance convention

Code, prompts, tests, cases, and notes in this repository are written by Claude, an AI engineering agent, under Enlai Weng's direction (Amendment 2). Every change reaches the main branch through a pull request Enlai reviews and merges; he reviews changes by their intent and their results, not by line-by-line code review. Claude's commits carry the trailer `AI-assisted: yes`, and GitHub marks Claude's pull requests as made through the Claude app, while Enlai's merges carry no such mark (ADR-9). Pull requests, review comments, and merges are the Phase 4 review record.

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
| not planned | 2.0 | Commercial six-week variant: written up as a design note instead of built (ADR-8); a build would need its own release decision record | n/a | 1.0 | See GOVERNANCE.md decision log |

## Verification entries (loops that did not require a release)

| Date | Loop | What was checked | Outcome |
|---|---|---|---|
| [date] | Vendor update | Full golden set on model [second version] | [Passed: version log, EVALUATION.md maintenance, model card, and inventory updated; no release / Failed: returned to build as agent-x.y] |
| [date] | Dataset repair | Case [id] relabeled: [reason] | DATASHEET.md 1.1; re-evaluated |

## Release notes

### 1.0, [date]

First release. Three outputs, no deny. Evaluated on 12 cases; results in the README. Known limitations in EVALUATION.md.

### 2.0 (not planned)

Not built in this version. The commercial variant (six weeks of conservative therapy) is written up as a design note showing how the regulation-change route would handle it; see ADR-8.
