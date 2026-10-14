# Golden Dataset Datasheet

EDOM Phase 3 artifact, kept with the golden set. Shape follows Gebru et al., Datasheets for Datasets. Updated whenever the set is repaired.

## Motivation

Created to evaluate a prior authorization review agent against Medicare LCD L34220 (Lumbar MRI) when no public prior authorization case data exists. Authored by Enlai Weng, [dates].

## Composition

Twelve cases (twenty in the original plan; reduced on 2026-10-13, before any case was authored). Each case is one FHIR R4 bundle (Patient, Condition, Procedure, Observation, MedicationRequest, Encounter, one DocumentReference containing an authored clinical note) plus a label file. By adjudicated outcome: 4 approvable, 3 documentation gap, 5 route. Within those twelve: 5 adversarial cases, of which 2 carry instruction-like text in the note; 3 held out from prompt tuning (cases 08, 10, and 12, in the same note style as the rest). Case numbers follow the original 20-case allocation (01 to 10, 12, 15), so a later version can add the other eight without renumbering. Not counted in the twelve: two paired fairness duplicates (one existing case with sex changed, one with race changed, otherwise identical), stored beside their originals. Demographics come from Synthea; clinical episodes were authored to exercise specific criteria of L34220 (revision effective October 23, 2025).

## Labels and labeling protocol

Per-criterion status (supported, unsupported, undeterminable) for every L34220 criterion applicable to the case, the record element supporting each status, the expected routing, and, for gap cases, the named missing item. Protocol: each case adjudicated against the policy text by Enlai Weng on [date], then re-adjudicated blind to the first pass after at least [7] days. Disagreements resolved by [rule: re-read the policy text; if still split, label undeterminable and route]. Second-pass agreement: [x of 12 cases identical at the routing level; y of z criterion statuses identical]. This is self-agreement by a single adjudicator, stated plainly.

Policy reading for C1, adopted 2026-10-14 before any case was authored. L34220 lists "other nerve root compromise" among its red flags and describes "no red flags" as no symptoms or signs suggesting nerve root disorder or spinal cord dysfunction. Read that way, any radiating leg pain would count. The same text also describes red flags as findings that suggest a medically emergent condition, qualifies its neurologic items as "clinically significant or progressive," and says an MRI for uncomplicated disc herniation is not medically necessary unless surgery or another aggressive treatment is under consideration. Read that way, only objective deficits count. National imaging guidance takes the second view. The ACR Appropriateness Criteria for low back pain (2021 update) describe patients as having pain "with or without radiculopathy" and "no red flags," rate MRI as usually not appropriate at first, and rate it usually appropriate after six weeks of management in a candidate for surgery or an injection. The American College of Physicians and American Pain Society guideline (Chou and colleagues, 2007) reserves prompt imaging for severe or progressive neurologic deficits or a suspected serious condition, and MRI for radiculopathy to persistent symptoms in a candidate for surgery or an epidural steroid injection. Commercial utilization criteria reviewed (BlueCross BlueShield of South Carolina, MRI Lumbar Spine CAM 709; HealthHelp 2025 lumbar MRI guideline) also require objective deficits or about six weeks of failed conservative care for adults. These do not bind a Medicare Advantage plan applying L34220 and are cited only as practice. This dataset therefore labels C1 supported for objective nerve root or spinal cord compromise in the record (clinically significant or progressive weakness, a reduced or absent reflex, sensory loss in a nerve root pattern, new bladder or bowel dysfunction, saddle or perianal sensory loss) and C1 unsupported for radiating leg pain or a positive straight leg raise alone. Each case's expected routing is also worked out under the broader reading before the case is committed, and a case whose routing would differ is rewritten (EVAL_PLAN.md, Golden set composition). No Noridian guidance interpreting "other nerve root compromise" was found. A conversation with a utilization management reviewer would test this reading and is noted as open.

## Provenance and generation

Synthea version [x], seed 20260910, population [n], age filter 55 to 90, state California, US Core export on. Twenty patients were drawn, at least fifteen of them aged 65 or older (twelve are used in version 1.0; the rest are kept for a later expansion), because a Medicare Advantage membership is predominantly 65 and older with a minority enrolled under 65 on the basis of disability. From each Synthea record only the Patient resource and a thin allowlisted baseline (up to three stable chronic conditions and their medications, nothing touching the spine, malignancy, infection, fracture, opioids, or imaging) were kept, with US Core profile tags stripped so bundles validate against base R4; the low back pain episode, therapy history, imaging history, requested-procedure Claim, and note are authored on top. Baselines in `data/golden/baselines/`; each case (spec, note, bundle, labels) in `data/golden/case_NN/`. Validator: HL7 FHIR validator [version], base R4 (no implementation guide), zero errors required; warnings recorded per case. Regeneration command in the README.

## Collection and consent

No human subjects. No real data. Nothing to consent to.

## Uses

Intended: evaluating criterion-level reasoning, citation faithfulness, gap detection, and routing for lumbar MRI prior authorization under L34220. Not intended: any other policy or procedure; training; any inference about real populations.

## Distribution and license

Redistributed in this repository under [license]. Synthea output is synthetic and unencumbered; the authored material is the author's. Policy text is quoted with attribution from the CMS Medicare Coverage Database. No CPT, CDT, or UB-04 code tables are included.

## Known limitations

Synthetic records are cleaner and more internally consistent than real charts. Cases were written by the same person who adjudicated them, so difficulty reflects one author's sense of the policy. The set is small; a single case moves a percentage by about eight points. There is no out-of-distribution check on note style in this version: the three held-out cases are unseen during tuning but written in the same style as the rest.

## Maintenance

Repaired when a mislabel is found during evaluation (dataset-repair loop); each repair logged here with date and reason. Version: [1.0, date].

| Version | Date | Change |
|---|---|---|
| 1.0 | [date] | Initial 12 cases plus 2 paired fairness duplicates |
