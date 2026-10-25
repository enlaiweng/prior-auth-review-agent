# Three readers, side by side

Made by `eval/tools/compare_readers.py` from the committed label files. It counts and lists; it does not decide who is right. Enlai settles each disagreement against the policy text and records the final label, with the reason, in each case's `labels.yaml`.

- **Enlai**: blind labels (`labels_blind.yaml`), entered on the labeling site on 2026-10-24.
- **Gemini**: the third reader (`labels_gemini.yaml`), gemini-3.8-flash through its API, run 40166566266 on 2026-10-24 (Pacific).
- **Intended**: Claude's intended answers, locked on 2026-10-15 and revealed on 2026-10-24 at 23:47 Pacific (`intended_answers.yaml`).

## Agreement

| Pair | Same routing (of 12) | Same criterion status (of 48) |
|---|---|---|
| Enlai and Gemini | 8 | 44 |
| Enlai and Intended | 7 | 43 |
| Gemini and Intended | 11 | 47 |
| All three | 7 | 43 |

Evidence is listed below but not counted: the readers were asked to cite the ids their answer is based on, and the instructions did not fix how many, so a shorter list is not by itself a disagreement. An evidence row is marked when one reader cites nothing where another cites something; those are worth a look.

## Cases to settle

Cases where the readers differ on a status, the routing, or the criterion named in a gap: 04, 05, 06, 07, 08, 10.
Cases where all three agree on all of those: 01, 02, 03, 09, 11, 12.
Of those, cases where the gap names the same criterion but the readers describe what is missing differently (the final label needs one description): 03.

## Case 01 (all three agree)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | supported | supported | supported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **approve** | **approve** | **approve** |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case01-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai `Procedure/case01-pt-01`; Gemini `Condition/case01-cond-01`, `Procedure/case01-pt-01`, `DocumentReference/case01-note-01`; Intended `Condition/case01-cond-01`, `Procedure/case01-pt-01`, `MedicationRequest/case01-med-01`, `Encounter/case01-enc-04`, `note:p2`
- C3 informs management: Enlai `Encounter/case01-enc-04`, `note:p5`; Gemini `Encounter/case01-enc-04`, `DocumentReference/case01-note-01`; Intended `Encounter/case01-enc-04`, `note:p5`
- C4 no duplicate imaging: none cited by any reader

## Case 02 (all three agree)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | unsupported | unsupported | unsupported |  |
| C3 informs management | unsupported | unsupported | unsupported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **route** | **route** | **route** |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case02-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai none; Gemini `Condition/case02-cond-01`, `Procedure/case02-pt-01`, `MedicationRequest/case02-med-01`, `note:p2`; Intended `Condition/case02-cond-01`, `Procedure/case02-pt-01`, `MedicationRequest/case02-med-01`, `note:p2` (one reader cites nothing here)
- C3 informs management: Enlai none; Gemini `note:p5`; Intended `note:p5` (one reader cites nothing here)
- C4 no duplicate imaging: none cited by any reader

## Case 03 (statuses, routing and gap criterion agree; gap wording differs)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | undeterminable | undeterminable | undeterminable |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **request** | **request** | **request** |  |
| Gap named | C2: 4 weeks of treatment required | C2: dates of the physical therapy | C2: dates, duration, and response of the physical therapy and anti-inflammatory treatment |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case03-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai none; Gemini `DocumentReference/case03-note-01`; Intended `note:p2` (one reader cites nothing here)
- C3 informs management: Enlai `Encounter/case03-enc-02`, `note:p5`; Gemini `Encounter/case03-enc-02`, `DocumentReference/case03-note-01`; Intended `Encounter/case03-enc-02`, `note:p5`
- C4 no duplicate imaging: none cited by any reader

## Case 04

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | undeterminable | supported | supported | differs |
| C2 conservative care | unsupported | unsupported | unsupported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **request** | **approve** | **approve** | **differs** |
| Gap named | C1: need further information on urgency. | none | none | differs |

Evidence cited:

- C1 red flag: Enlai `Encounter/case04-enc-02`, `note:p5`; Gemini `Observation/case04-obs-01`, `Observation/case04-obs-02`, `note:p3`, `note:p4`; Intended `Observation/case04-obs-01`, `Observation/case04-obs-02`, `Encounter/case04-enc-02`, `note:p1`, `note:p3`
- C2 conservative care: Enlai none; Gemini `MedicationRequest/case04-med-01`, `note:p1`, `note:p2`; Intended `Condition/case04-cond-01`, `MedicationRequest/case04-med-01` (one reader cites nothing here)
- C3 informs management: Enlai `Encounter/case04-enc-02`, `note:p5`; Gemini `Encounter/case04-enc-02`, `note:p5`; Intended `Encounter/case04-enc-02`, `note:p5`
- C4 no duplicate imaging: none cited by any reader

## Case 05

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | supported | supported | supported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | undeterminable | unsupported | unsupported | differs |
| **Routing** | **request** | **route** | **route** | **differs** |
| Gap named | C4: not determined if duplicate MRI is needed. need confirmation. | none | none | differs |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case05-obs-02`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai `Procedure/case05-pt-01`, `note:p2`; Gemini `Condition/case05-cond-01`, `Procedure/case05-pt-01`, `MedicationRequest/case05-med-01`, `DocumentReference/case05-note-01`; Intended `Procedure/case05-pt-01`, `MedicationRequest/case05-med-01`, `note:p2`
- C3 informs management: Enlai `Encounter/case05-enc-04`, `note:p5`; Gemini `Encounter/case05-enc-04`, `DocumentReference/case05-note-01`; Intended `Encounter/case05-enc-04`, `note:p5`
- C4 no duplicate imaging: Enlai `DiagnosticReport/case05-dr-01`, `note:p5`; Gemini `Procedure/case05-img-01`, `DiagnosticReport/case05-dr-01`, `DocumentReference/case05-note-01`; Intended `Procedure/case05-img-01`, `DiagnosticReport/case05-dr-01`, `Observation/case05-obs-01`, `Observation/case05-obs-02`, `note:p1`, `note:p3`, `note:p4`, `note:p5`

## Case 06

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | undeterminable | undeterminable | undeterminable |  |
| C2 conservative care | unsupported | unsupported | unsupported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **request** | **route** | **route** | **differs** |
| Gap named | C1: Clarification of history of cancer. | none | none | differs |

Evidence cited:

- C1 red flag: Enlai `Condition/case06-cond-02`, `note:p2`, `note:p5`; Gemini `Condition/case06-cond-02`, `note:p2`, `note:p4`; Intended `Condition/case06-cond-02`, `Procedure/case06-proc-01`, `note:p2`
- C2 conservative care: Enlai none; Gemini `Condition/case06-cond-01`, `Encounter/case06-enc-01`, `MedicationRequest/case06-med-01`, `note:p1`; Intended `Condition/case06-cond-01`, `note:p1` (one reader cites nothing here)
- C3 informs management: Enlai none; Gemini `note:p5`; Intended `note:p5` (one reader cites nothing here)
- C4 no duplicate imaging: none cited by any reader

## Case 07

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | supported | supported | supported |  |
| C3 informs management | unsupported | unsupported | undeterminable | differs |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **route** | **route** | **request** | **differs** |
| Gap named | none | none | C3: the treatment decision the MRI will inform, such as a planned injection or surgical evaluation | differs |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case07-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai `Procedure/case07-pt-01`; Gemini `Condition/case07-cond-01`, `MedicationRequest/case07-med-01`, `MedicationRequest/case07-med-02`, `Procedure/case07-pt-01`, `note:p1`, `note:p2`; Intended `Procedure/case07-pt-01`, `MedicationRequest/case07-med-01`, `MedicationRequest/case07-med-02`, `note:p2`
- C3 informs management: Enlai none; Gemini none; Intended `note:p5` (one reader cites nothing here)
- C4 no duplicate imaging: none cited by any reader

## Case 08

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | unsupported | undeterminable | undeterminable | differs |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **route** | **route** | **route** |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case08-obs-01`, `note:p5`, `note:p7` (one reader cites nothing here)
- C2 conservative care: Enlai `Procedure/case08-pt-01`; Gemini `Procedure/case08-pt-01`, `MedicationRequest/case08-med-01`, `note:p6`; Intended `Procedure/case08-pt-01`, `MedicationRequest/case08-med-01`, `Encounter/case08-enc-01`, `note:p6`
- C3 informs management: Enlai `Encounter/case08-enc-02`, `note:p9`; Gemini `Encounter/case08-enc-02`, `note:p9`; Intended `Encounter/case08-enc-02`, `note:p9`
- C4 no duplicate imaging: none cited by any reader

## Case 09 (all three agree)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | supported | supported | supported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **approve** | **approve** | **approve** |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case09-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai `Encounter/case09-enc-04`, `Procedure/case09-pt-01`; Gemini `Condition/case09-cond-01`, `Encounter/case09-enc-01`, `Encounter/case09-enc-02`, `Encounter/case09-enc-03`, `Encounter/case09-enc-04`, `MedicationRequest/case09-med-01`, `Procedure/case09-pt-01`, `note:p1`, `note:p2`; Intended `Condition/case09-cond-01`, `Procedure/case09-pt-01`, `MedicationRequest/case09-med-01`, `Encounter/case09-enc-04`, `note:p2`
- C3 informs management: Enlai `Encounter/case09-enc-04`, `note:p5`; Gemini `Encounter/case09-enc-04`, `note:p5`; Intended `Encounter/case09-enc-04`, `note:p5`
- C4 no duplicate imaging: none cited by any reader

## Case 10

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | supported | supported | supported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | undeterminable | undeterminable | differs |
| **Routing** | **approve** | **request** | **request** | **differs** |
| Gap named | none | C4: lumbar CT report | C4: the result of the lumbar CT of 2026-04-15 and why an MRI is needed in addition to it | differs |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case10-obs-01`, `note:p4`, `note:p5` (one reader cites nothing here)
- C2 conservative care: Enlai `Procedure/case10-pt-01`; Gemini `Condition/case10-cond-01`, `MedicationRequest/case10-med-01`, `Procedure/case10-pt-01`, `note:p4`; Intended `Procedure/case10-pt-01`, `MedicationRequest/case10-med-01`, `note:p4`
- C3 informs management: Enlai `Encounter/case10-enc-03`, `note:p7`; Gemini `Encounter/case10-enc-03`, `note:p7`; Intended `Encounter/case10-enc-03`, `note:p7`
- C4 no duplicate imaging: Enlai none; Gemini `Procedure/case10-img-01`; Intended `Procedure/case10-img-01`, `Encounter/case10-enc-01` (one reader cites nothing here)

## Case 11 (all three agree)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | unsupported | unsupported | unsupported |  |
| C2 conservative care | undeterminable | undeterminable | undeterminable |  |
| C3 informs management | unsupported | unsupported | unsupported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **route** | **route** | **route** |  |

Evidence cited:

- C1 red flag: Enlai none; Gemini none; Intended `Observation/case11-obs-01`, `note:p1`, `note:p3` (one reader cites nothing here)
- C2 conservative care: Enlai `note:p2`; Gemini `DocumentReference/case11-note-01`; Intended `note:p2`
- C3 informs management: Enlai none; Gemini `DocumentReference/case11-note-01`; Intended `note:p5` (one reader cites nothing here)
- C4 no duplicate imaging: none cited by any reader

## Case 12 (all three agree)

| | Enlai | Gemini | Intended | |
|---|---|---|---|---|
| C1 red flag | supported | supported | supported |  |
| C2 conservative care | unsupported | unsupported | unsupported |  |
| C3 informs management | supported | supported | supported |  |
| C4 no duplicate imaging | supported | supported | supported |  |
| **Routing** | **approve** | **approve** | **approve** |  |

Evidence cited:

- C1 red flag: Enlai `Observation/case12-obs-02`, `note:p3`, `note:p7`; Gemini `Observation/case12-obs-01`, `Observation/case12-obs-02`, `Observation/case12-obs-03`, `DocumentReference/case12-note-01`; Intended `Observation/case12-obs-01`, `Observation/case12-obs-02`, `Observation/case12-obs-03`, `Encounter/case12-enc-03`, `note:p3`
- C2 conservative care: Enlai none; Gemini `Condition/case12-cond-01`, `MedicationRequest/case12-med-01`, `DocumentReference/case12-note-01`; Intended `Condition/case12-cond-01`, `MedicationRequest/case12-med-01` (one reader cites nothing here)
- C3 informs management: Enlai `note:p10`; Gemini `DocumentReference/case12-note-01`; Intended `note:p9`, `note:p10`
- C4 no duplicate imaging: Enlai none; Gemini none; Intended `Procedure/case12-img-01`, `DiagnosticReport/case12-dr-01` (one reader cites nothing here)
