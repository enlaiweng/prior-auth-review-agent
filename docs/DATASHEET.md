# Golden Dataset Datasheet

EDOM Phase 3 artifact, kept with the golden set. Shape follows Gebru et al., Datasheets for Datasets. Updated whenever the set is repaired.

## Motivation

Created to evaluate a prior authorization review agent against Medicare LCD L34220 (Lumbar MRI) when no public prior authorization case data exists. Authored by Enlai Weng, [dates].

## Composition

Twenty cases. Each case is one FHIR R4 bundle (Patient, Condition, Procedure, Observation, MedicationRequest, Encounter, one DocumentReference containing an authored clinical note) plus a label file. By adjudicated outcome: 8 approvable, 6 documentation gap, 6 route. Within those twenty: 6 adversarial cases, of which 3 carry instruction-like text in the note; 3 authored in a held-out note style and excluded from prompt iteration. Not counted in the twenty: two paired fairness duplicates (one existing case with sex changed, one with race changed, otherwise identical), stored beside their originals. Demographics come from Synthea; clinical episodes were authored to exercise specific criteria of L34220 (revision effective October 23, 2025).

## Labels and labeling protocol

Per-criterion status (supported, unsupported, undeterminable) for every L34220 criterion applicable to the case, the record element supporting each status, the expected routing, and, for gap cases, the named missing item. Protocol: each case adjudicated against the policy text by Enlai Weng on [date], then re-adjudicated blind to the first pass after at least [7] days. Disagreements resolved by [rule: re-read the policy text; if still split, label undeterminable and route]. Second-pass agreement: [x of 20 cases identical at the routing level; y of z criterion statuses identical]. This is self-agreement by a single adjudicator, stated plainly.

## Provenance and generation

Synthea version [x], seed 20260910, population [n], age filter 55 to 90, state California, US Core export on. Patients were chosen with at least fifteen of twenty aged 65 or older, because a Medicare Advantage membership is predominantly 65 and older with a minority enrolled under 65 on the basis of disability. From each Synthea record only the Patient resource and a thin allowlisted baseline (up to three stable chronic conditions and their medications, nothing touching the spine, malignancy, infection, fracture, opioids, or imaging) were kept, with US Core profile tags stripped so bundles validate against base R4; the low back pain episode, therapy history, imaging history, requested-procedure Claim, and note are authored on top. Baselines in `data/golden/baselines/`; each case (spec, note, bundle, labels) in `data/golden/case_NN/`. Validator: HL7 FHIR validator [version], base R4 (no implementation guide), zero errors required; warnings recorded per case. Regeneration command in the README.

## Collection and consent

No human subjects. No real data. Nothing to consent to.

## Uses

Intended: evaluating criterion-level reasoning, citation faithfulness, gap detection, and routing for lumbar MRI prior authorization under L34220. Not intended: any other policy or procedure; training; any inference about real populations.

## Distribution and license

Redistributed in this repository under [license]. Synthea output is synthetic and unencumbered; the authored material is the author's. Policy text is quoted with attribution from the CMS Medicare Coverage Database. No CPT, CDT, or UB-04 code tables are included.

## Known limitations

Synthetic records are cleaner and more internally consistent than real charts. Cases were written by the same person who adjudicated them, so difficulty reflects one author's sense of the policy. The set is small; a single case moves a percentage by five points. The held-out note-style cases are the only out-of-distribution check.

## Maintenance

Repaired when a mislabel is found during evaluation (dataset-repair loop); each repair logged here with date and reason. Version: [1.0, date].

| Version | Date | Change |
|---|---|---|
| 1.0 | [date] | Initial 20 cases plus 2 paired fairness duplicates |
