# Changelog

Three registers in one file, kept from the first build onward: the version log for prompts, retrieval configuration, and model versions (EDOM Phase 4); change control records and release notes (Phase 6); and verification entries from Phase 7 loops. One dated line per change. If a reader cannot reconstruct what ran on a given date from this file, it is incomplete.

## Provenance convention

Code, prompts, tests, cases, and notes in this repository are written by Claude, an AI engineering agent, under Enlai Weng's direction (Amendment 2). Every change reaches the main branch through a pull request Enlai reviews and merges; he reviews changes by their intent and their results, not by line-by-line code review. Claude's commits are authored as Claude and carry the trailer `AI-assisted: yes` (on 17 commits made from 2026-10-13 to 2026-10-15 it is missing, or written in the message where git does not read it as a trailer; their author field shows Claude), and GitHub marks Claude's pull requests as made through the Claude app, while Enlai's merges carry no such mark (ADR-9). Pull requests, review comments, and merges are the Phase 4 review record.

## Version log (prompts, retrieval, model)

| Date | Version | What changed | Why | Evaluation run |
|---|---|---|---|---|
| 2026-10-16 | agent-0.1 | Initial agent (agent/README.md): instructions, decision schema, the note split into numbered paragraphs, all 47 policy passages tagged by criterion, the routing rule in code (ADR-10); claude-sonnet-5, effort high, adaptive thinking, 16,000 maximum output tokens, JSON schema output; spec fingerprint 26e8981e5d35 (agent/spec.generated.js) | Baseline; the rule tightened after two rounds of independent review, before any golden case ran | Smoke case only (case 00), experiments budget, four runs: 38870389448 (draft spec 1bcb901dd1b5) route; 38880895954 and 38881163782 (spec deecf2870fc6, same prompt) request, then route; 38883781888 (final spec) request. The flip is C3 read as undeterminable or unsupported on the same prompt. Quotes joined or changed policy words in every run, so citation faithfulness stayed below 95%. Cost $0.075 to $0.104 per run, about 80 seconds. No prompt change made from these (eval/README.md, rule 2). Run 1 to follow |
| 2026-10-19 | agent-0.2 | The routing rule checks for approval before the red-flag step. A red flag on the note alone, with nothing the rule accepts behind it, or contradicted, still never carries an approval and still routes a case that is not approvable; it no longer blocks an approval that C2 carries, and such an approval notes the red flag in its reasons. The model's system prompt changes only by the new C1 sentence from EVAL_PLAN.md (the criteria text is part of it); the spec fingerprint, which also covers routing.js and agent.js, is now 0c7ef2abfd94. Schema, model, and settings unchanged | The owner's decision on the criteria before any label (ADR-12), not a change made to fix a failure on a case, which is what eval/README.md rule 2 and GOVERNANCE.md R13 govern; the case-content check (ADR-10 (5)) is in its pull request | None yet; agent-0.1's four smoke case runs stand for agent-0.1 |
| 2026-11-11 | agent-0.3 | One instruction changed: the policy quote must be one unbroken run of words copied exactly from one cited passage, with no ellipsis and nothing joined. The routing rule, the schema, the model, and the settings are unchanged; the spec fingerprint is now d5ece339fac3 (agent/spec.generated.js) | The first run on golden cases, agent-0.2 on the development cases (01 to 05) after all twelve final labels were merged: routing matched on 5 of 5 cases, statuses on 20 of 20, and every cited id was valid, but 7 of 20 quotes joined separate phrases with an ellipsis (cases 01, 02, 03, and 05). Each phrase was accurate; a joined quote is not text that appears in the policy, so citation faithfulness was 65 percent against a threshold of 95 | Experiments budget, cases 01 to 05, one run each: 43148883470 (agent-0.2, the baseline; citation faithfulness worked out from the run's notices with the scorer's own check); 43149626969 (agent-0.3): citation faithfulness 100 percent (20 of 20), evidence validity 100 percent, per-criterion agreement 100 percent, routing agreement 100 percent, no false approval on the 3 cases that are not approvable. Release budget, the 9 cases not held out, one run that served as the smoke run and run 1: 43151946612 (eval/runs/2026-11-12_agent-0.3_nine_release_run-43151946612): every threshold met; no false approval on the 6 cases that are not approvable; citation faithfulness 100 percent; evidence validity 100 percent of 121 ids; per-criterion agreement 97 percent; routing agreement 100 percent. Experiments budget, while the release evaluation's tooling was built (the agent unchanged): 43160462842, a rehearsal on the smoke case three ways (as it is, without its note, and on claude-sonnet-5-5), no error; 43160885943, cases 01 to 05 with the changed run script: routing 5 of 5, statuses 20 of 20, evidence validity 100 percent, citation faithfulness 95 percent (19 of 20: in case 02, C2, the quote began with an added "the"); 43163459975, the same five cases after the run-title change: the same result, with the same added "the" in case 02, C2 (19 of 20); 43166492232, the same five cases after the change that keeps a release run's results: routing 5 of 5, statuses 20 of 20, all 20 quotes word for word |
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
