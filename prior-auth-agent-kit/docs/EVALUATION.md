# Evaluation Report and Model Card

EDOM Phase 5 artifact. First half: the evaluation report, organized after the TRIPOD-LLM reporting items (what was evaluated, on what data, against which pre-set thresholds, with what errors and limitations) so a reader outside the project can reconstruct what was tested; this is a reporting shape, not a compliance claim. Second half: the model card, in the CHAI Applied Model Card layout. Written after evaluation; may follow deployment by up to a week. Revised after the vendor-update re-evaluation.

## Part 1: Evaluation report

### What was evaluated

Agent version [tag] (see CHANGELOG.md for prompt and configuration versions). Model [vendor, name, version]. Golden set version [1.0] (20 cases plus 2 paired fairness duplicates, DATASHEET.md). Evaluation harness [path], run [date].

### Results against release thresholds

| Metric | Threshold | Result | Pass |
|---|---|---|---|
| False approvals | 0 | [0 of n] | [ ] |
| Citation faithfulness | 95% | [ ] | [ ] |
| Routing agreement | [ ] | [ ] | [ ] |
| Per-criterion agreement | [ ] | [ ] | [ ] |
| Missing-documentation recall | [ ] | [ ] | [ ] |
| Abstention calibration | [ ] | [ ] | [ ] |
| Pend rate | reported | [ ] | n/a |
| Reviewer minutes per case (method: [ ]) | reported | [ ] | n/a |

### Adversarial, held-out, ablation, and variance results

Instruction-bearing notes: [n of 3] handled correctly (routing and citations unchanged by the instruction). Held-out note-style cases: [results on 3]. Paired fairness checks (sex, race): [identical / differed in: ]. Conflicting note versus structured data: [results]. No-notes ablation: [per-criterion agreement and routing agreement with the note removed, beside the main figures]. Repeat-run variance: [range across three runs for each gated metric; any metric whose range crosses its threshold is marked not stably met].

### Error analysis by type

| Failure type | Count | Example case | Note |
|---|---|---|---|
| Missed evidence in structured data | | | |
| Missed evidence in note | | | |
| Policy text misread | | | |
| Over-approval | | | |
| Over-routing | | | |
| Citation fabricated or mismatched | | | |
| Instruction in note followed | | | |

### Runs and iterations

| Run | Date | Agent version | Change since prior run | Outcome |
|---|---|---|---|---|
| 1 | | | baseline | |
| 2 | | | | |

### Limitations

Small synthetic set authored and adjudicated by one person; self-agreement recorded in the datasheet. No real charts. No user study. Reviewer-minutes figure is an estimate from output structure, not observed time.

### Maintenance: vendor-update re-evaluation

Second model version [second model id], run [date]: [table of the same metrics]. Outcome: [passed, no release required; or failed, returned to build]. Logged in CHANGELOG.md.

## Part 2: Model card (CHAI Applied Model Card layout)

Fields that do not apply to a synthetic-data portfolio build are marked "not applicable" rather than removed, so the shape of the card is intact.

### Identification and release

Name: Prior Auth Review Agent. Developer: Enlai Weng. Version: [tag]. Release date: [date]. Contact: [email]. Regulatory status: not a medical device; decision support for a payer reviewer, on synthetic data.

### Uses and directions

Intended use and workflow: first-pass review of lumbar MRI prior authorization requests at a Medicare Advantage plan against Noridian LCD L34220; output appears on the request in the reviewer's worklist. Primary users: UM nurse reviewers; physician reviewers receive routed cases. Target population: adults with a lumbar MRI request under the stated policy. How to use: submit the request bundle; approvals are issued and appear in the audit queue with citations; confirm documentation requests before they go to the provider; routed cases go to the physician with the summary and the record. Targeted outcome: faster, better-cited first-pass review with no algorithmic denial.

### Warnings

Known risks and limitations: false approval is the residual harm class, and approvals are issued without pre-review; over-reliance on the agent's summary by the physician reviewer; documentation requests could be read as delay if not tied to a named criterion. Known biases: none measurable on synthetic data; paired checks reported above. Risk tier: moderate (CHARTER.md). Cautioned out-of-scope use: any other policy or procedure; pediatric cases; real patient data without agreement and re-evaluation; any deployment where the output is not reviewed by a person before a denial.

### Trust ingredients

Model type: large language model orchestration with retrieval over policy text and structured outputs; no training. Foundation model: [vendor, version]. Input data source: FHIR R4 bundles (synthetic) and policy text. Output: structured decision object with citations. Development data: synthetic, see DATASHEET.md. Data type and size: 20 cases. Human oversight: approvals are audited by sample and reversible; documentation requests are confirmed by the reviewer; routed cases are decided by a physician; no deny path exists; a kill switch withdraws the approve authority.

### Key metrics

Usefulness: routing agreement [ ], per-criterion agreement [ ], missing-documentation recall [ ]. Fairness and equity: paired-case result [ ]; statistical test not applicable. Safety and reliability: false approvals [0], citation faithfulness [ ], instruction-bearing note results [ ].

### Resources

Evaluation report: Part 1 above. Datasheet: DATASHEET.md. Runbook and kill switch: RUNBOOK.md. Regime mapping and risk register: GOVERNANCE.md. Peer-reviewed publications: not applicable. Patient consent or disclosure: not applicable (synthetic data).
