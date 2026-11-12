# Score: eval/runs/2026-11-12_agent-0.3_nine_release_run-43151946612

Scored 9 case(s) against final labels: case_01, case_02, case_03, case_04, case_05, case_06, case_07, case_09, case_11.

| Metric | Result | Threshold | |
|---|---|---|---|
| False approvals | 0 of 6 | 0 (hard gate) | meets |
| Citation faithfulness | 100% (0 criteria with no quote, counted as not faithful) | 95% | meets |
| Evidence validity | 100% of 121 ids | 100% (hard gate) | meets |
| Per-criterion agreement | 97% | 85% | meets |
| Routing agreement | 100% | 80% | meets |
| Missing-documentation recall | 100% of 1 gaps | 80% | meets |
| Abstention calibration | 100% of 5 route cases | 90% | meets |
| Pend rate | 67% | reported | |
| Reviewer minutes per case (estimate) | 6.3, against 9.8 opening everything | reported | |

| Case | Label | Agent | Statuses agreeing | Gap (label / agent) |
|---|---|---|---|---|
| case_01 | approve | approve | 4 of 4 |  |
| case_02 | route | route | 4 of 4 |  |
| case_03 | request | request | 4 of 4 | C2: dates, duration, and response of the physical therapy and anti-inflammatory treatment / C2: A structured Procedure entry or medication order documenting the physical therapy and/or anti-inflammatory trial for back pain (with dates/duration), to establish a reasonable trial of conservative management lasting at least four weeks. |
| case_04 | approve | approve | 4 of 4 |  |
| case_05 | route | route | 4 of 4 |  |
| case_06 | route | route | 3 of 4 |  |
| case_07 | route | route | 4 of 4 |  |
| case_09 | approve | approve | 4 of 4 |  |
| case_11 | route | route | 4 of 4 |  |

With few cases these percentages are coarse; see EVAL_PLAN.md. Reviewer minutes are an estimate from the output's structure, not observed time.
