# Changelog

Three registers in one file, kept from the first build onward: the version log for prompts, retrieval configuration, and model versions (EDOM Phase 4); change control records and release notes (Phase 6); and verification entries from Phase 7 loops. One dated line per change. If a reader cannot reconstruct what ran on a given date from this file, it is incomplete.

## Provenance convention

Code, prompts, tests, cases, and notes in this repository are written by Claude, an AI engineering agent, under Enlai Weng's direction (Amendment 2). Every change reaches the main branch through a pull request Enlai reviews and merges; he reviews changes by their intent and their results, not by line-by-line code review. Claude's commits are authored as Claude and carry the trailer `AI-assisted: yes` (on 17 commits made from 2026-10-13 to 2026-10-15 it is missing, or written in the message where git does not read it as a trailer; their author field shows Claude), and GitHub marks Claude's pull requests as made through the Claude app, while Enlai's merges carry no such mark (ADR-9). Pull requests, review comments, and merges are the Phase 4 review record.

## Version log (prompts, retrieval, model)

| Date | Version | What changed | Why | Evaluation run |
|---|---|---|---|---|
| 2026-10-16 | agent-0.1 | Initial agent (agent/README.md): instructions, decision schema, the note split into numbered paragraphs, all 47 policy passages tagged by criterion, the routing rule in code (ADR-10); claude-sonnet-5, effort high, adaptive thinking, 16,000 maximum output tokens, JSON schema output; spec fingerprint deecf2870fc6 (agent/spec.generated.js) | Baseline; the rule tightened after an independent review, before any golden case ran | Smoke case only (case 00), experiments budget. Draft spec 1bcb901dd1b5, Agent run 38870389448: routed (C3 read as unsupported) where the placeholder label says request. Final spec, Agent run 38880895954: request on C3, all four statuses and the gap matching the placeholder label. Both runs quoted policy text with words joined or added, so citation faithfulness was below 95%. No prompt change made from either (eval/README.md, rule 2). Run 1 to follow |
| [date] | agent-0.2 | [e.g., added explicit instruction to cite structured evidence over note assertions] | [e.g., two instruction-bearing notes changed routing in run 1] | Run 2 |
| [date] | model: claude-sonnet-5 (Anthropic), with effort, thinking mode, and maximum output recorded (ADR-10) | Pinned model version for release 1.0 | Reproducibility | |

## Change control records

| Date | Release | What changed | Approval | Rollback target | Notes |
|---|---|---|---|---|---|
| [date, about 2026-11-04] | 0.9 | First deployment, in checklist mode (approve output off): agent-[x], golden set 1.0, demo surface | Owner's approval of the deployment run | none | Approve output turned on only at 1.0 |
| [date] | 1.0 | Approve output turned on: agent-[x], golden set 1.0, demo surface | RELEASE_DECISION.md signed [date] | none (first release) | Runbook and monitoring thresholds in place before first demo |
| [date] | 1.0.1 | [hotfix, if any: scope limited to the fix; re-evaluated on affected cases] | | 1.0 | |
| not planned | 2.0 | Commercial six-week variant: written up as a design note instead of built (ADR-8); a build would need its own release decision record | n/a | 1.0 | See GOVERNANCE.md decision log |

## Verification entries (loops that did not require a release)

| Date | Loop | What was checked | Outcome |
|---|---|---|---|
| [date] | Vendor update | Full golden set on model claude-sonnet-5-5 | [Passed: version log, EVALUATION.md maintenance, model card, and inventory updated; no release / Failed: returned to build as agent-x.y] |
| [date] | Dataset repair | Case [id] relabeled: [reason] | DATASHEET.md 1.1; re-evaluated |

## Release notes

### 1.0, [date]

First release. Three outputs, no deny. Evaluated on 12 cases; results in the README. Known limitations in EVALUATION.md.

### 2.0 (not planned)

Not built in this version. The commercial variant (six weeks of conservative therapy) is written up as a design note showing how the regulation-change route would handle it; see ADR-8.
