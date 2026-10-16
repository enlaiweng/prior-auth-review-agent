# The agent

This folder is the versioned agent specification (docs/ARCHITECTURE.md, ADR-10): the instructions, the shape of the report, the input step, and the rule that chooses the outcome. One JavaScript module, used by the evaluation runs and, later, by the Cloudflare Worker, so the demo runs the agent that was evaluated. Current version: **agent-0.1**.

## How a case is decided

1. **Input step** (`record.js`). The visit note is decoded from its DocumentReference and split into paragraphs exactly as `eval/tools/build_case_pages.py` splits them for the labeling page, numbered `note:p1` onward. The rest of the bundle goes to the model unchanged, demographics included. The model also gets the list of ids it may cite.
2. **The model's report** (`agent.js`, `instructions.md`, `decision_schema.json`). The model reads the policy passages, the criteria, and the case, and returns, for each of C1 to C4: a status, the ids it rests on, the policy passages and words it was checked against, and a short explanation. It also lists any contradiction in the record and any single missing document. The report comes back through the API's JSON schema output format, and the code checks its shape again before using it.
3. **The rule in code** (`routing.js`). The model never chooses the outcome. The code does, in this order:

| Step | Outcome |
|---|---|
| Checklist mode is on (the kill switch) | route |
| Any cited id is not in the case | route |
| A red flag rests on the visit note alone, or the record contradicts itself on C1 | route |
| C3 and C4 are met, and C1 or C2 is met with a record entry other than the visit note | approve |
| One criterion other than C1 is undeterminable for want of one named document, nothing is contradicted, and that document would make the case approvable | request, naming the criterion and the document |
| Anything else | route |

"Met" means: status supported, at least one valid policy passage cited, and no contradiction reported on that criterion. For C1, the entry behind it must be a Condition, Observation, Procedure, imaging report (DiagnosticReport), or medication order. For C2, it must be a therapy Procedure or a medication order that started within the year before the request date. C3 must cite at least one id. C4 may cite nothing, since "no prior lumbar imaging" rests on an absence.

A red flag "rests on the visit note alone" when the model calls C1 supported or undeterminable, cites the note, and cites none of the entries that count for C1.

Every decision carries plain-language reasons naming the step that decided it.

## Readings written into the rule

ADR-10 and EVAL_PLAN.md state the rule in a few sentences. Writing it as code needed these readings. Every one makes an approval harder, never easier.

1. **A policy citation for every applicable criterion.** The charter says the system may never "issue an approval without a citation for every applicable criterion". So C3, C4, and the criterion the approval rests on each need a valid policy passage.
2. **C3 needs a cited id.** A supported C3 says something the record contains, so it must point to it.
3. **What can stand behind C1:** a Condition, Observation, Procedure, DiagnosticReport, or MedicationRequest. The request itself (Claim), the Patient, the visits (Encounter), and the note can't, because none of them records a clinical finding. Whether a visit's recorded reason should count is a question for after labeling.
4. **What can stand behind C2:** a Procedure or a medication order that started on or before the request date and within the 365 days before it. Code can't tell a therapy Procedure from another Procedure, so any dated Procedure in that window counts; the window keeps an old order for an unrelated condition from counting.
5. **A note-only or contradicted red flag routes the whole case**, as EVAL_PLAN.md's C1 says ("is labeled undeterminable, and the case routes"), even if C2 would otherwise approve. A contradiction on C2, C3, or C4 blocks approval on that criterion and blocks any request.
6. **Invalid ids route, whatever else holds.** ADR-10 requires valid ids for an approval; the code also routes rather than requests when an id is invalid.

## Settings (pinned, recorded with every run)

| Setting | Value |
|---|---|
| Model | `claude-sonnet-5` (the run records the exact version the API returns) |
| Effort | `high` (the model's default) |
| Thinking | adaptive (the model's default; its text is not returned) |
| Maximum output tokens | 16,000 (thinking counts toward it); each call times out after 280 seconds and is tried again, up to 5 attempts |
| Output | JSON schema output format (`output_config.format`); no tools, no forced tool use |
| Temperature | not sent; the model rejects any other value |
| Policy text | all 47 passages of L34220 in every request, each tagged by criterion; at this policy's size, retrieval by criterion is the tag, and the passages sit in the cached part of the prompt |

The per-criterion explanation is named `explanation`, not `reasoning`: Anthropic's documentation on refusals lists a `reasoning` field in JSON output as a common cause of the API declining a request on newer models such as Sonnet 5.5, which would break the vendor-update run.

These are fixed at the freeze. The vendor-update run on claude-sonnet-5-5 uses the same named settings; that model's effort levels are recalibrated, so it is the same setting by name, not the same amount of thinking.

## Files

| File | What it is |
|---|---|
| `instructions.md` | The instructions, written by hand. No case-specific content. |
| `decision_schema.json` | The shape of the model's report |
| `record.js` | The input step |
| `routing.js` | The rule |
| `agent.js` | The model call, the checks, and the decision object |
| `spec.generated.js` | Made by `eval/tools/build_agent_spec.py`: the full system prompt (instructions, criteria from EVAL_PLAN.md, outcomes from the charter, policy passages), the schema, and `SPEC_SHA256`, one fingerprint over all of it and the three code files |
| `test/` | Tests: the rule, the input step against the Python on every bundle, the module with a fake model, and a full run with a fake model, including the budget and labels-first guards |

## How to run it

Runs happen on GitHub, in the **Agent run** workflow (see `.github/workflows/agent-run.yml`). On a computer, from the repository root, with a key in `ANTHROPIC_API_KEY`:

```
node eval/run_agent.mjs --cases smoke --budget experiments --out eval/runs/my-run
python3 eval/score.py eval/runs/my-run
```

Tests, which call no model: `node --test 'agent/test/*.test.js'`.

## Case-content check

Before each agent version is merged, a separate reviewer compares this folder's instructions, schema, and rule with the twelve case pages and reports anything specific to a golden case (ADR-10 (5); GOVERNANCE.md, R13). The report is in the agent's pull request.
