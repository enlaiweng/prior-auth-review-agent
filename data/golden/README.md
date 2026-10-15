# Golden set

Twelve cases (01 to 10, 12, and 15) and two paired fairness duplicates. What each case tests, how the labels are made, and the limits of the set are in [docs/DATASHEET.md](../../docs/DATASHEET.md) and [docs/EVAL_PLAN.md](../../docs/EVAL_PLAN.md).

## What is in each case folder

| File | What it is | Made by |
|---|---|---|
| `case_spec.yaml` | The case's facts: dates, visits, therapy, imaging, exam findings, past history, the requested MRI | Written by Claude |
| `note.md` | The last visit note | Written by Claude; the notes of cases 08, 10 and 12 are to be restyled by Enlai Weng in the Gemini app before labeling |
| `bundle.json` | The FHIR R4 record the agent reads | `eval/tools/render_case.py`, from the spec, the note, and the patient's baseline |
| `case_page.md` | The record as a readable page, with the ids labels cite | `eval/tools/build_case_pages.py`, from the bundle |
| `labels_blind.yaml` | Enlai Weng's blind labels (added at labeling) | The labeling page, `eval/labeling/labeling.html` |
| `labels.yaml` | Final labels, after disagreements are settled (added later) | Enlai Weng |

`case_01_pair_sex` and `case_09_pair_race` hold the fairness duplicates. Each is its original with one attribute of the patient changed (`eval/tools/make_pair.py`); ids, dates, and the note are the same, so they share the original's labels.

Other files: `patients.txt` (the 20 patients picked), `baselines/` (one thin baseline per patient, plus the two pair baselines), and `_template/`.

## Order of steps before labeling

1. Cases written, rendered, and validated (this folder).
2. The three held-out notes restyled in the Gemini app, then normalized: `python3 eval/tools/normalize_note.py data/golden/case_08/note.md` (and 10, 12). This changes typography only, so no note stands out by its characters.
3. Everything made from the notes rebuilt and committed: `bash eval/tools/rebuild_golden.sh`. That remakes the bundles, case pages, labeling page, and the third reader's prompts with their fingerprints.
4. The intended answers locked: encrypted and committed (EVAL_PLAN.md, How the answer key is made).
5. Labeling.

The `Validate golden set` workflow checks on every change that step 3's files match the specs and notes, and that every bundle validates with 0 errors.

## Regenerate it from the seed

From the repository root, with Java 21 and Python 3.11 or later, and these packages: `python3 -m pip install "fhir.resources==8.3.0" "pydantic==2.13.5" "pyyaml==6.0.3"`. Other versions can write the JSON differently. The two `.jar` files go in `tools/`, which git ignores:

| File | Download | sha256 |
|---|---|---|
| `tools/synthea-with-dependencies.jar` | https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar (downloaded 2026-10-15; build d9d07a6) | `018ad7f04f7aacb995804d7d4781c76d5fc714f7f23257ba50daa9eefae224ac` |
| `tools/validator_cli.jar` | https://github.com/hapifhir/org.hl7.fhir.core/releases/download/7.0.2/validator_cli.jar | `e3e50f06b806437821b7aef8189a1b790415cb96c5036e0812ed62981452b377` |

The Synthea link points to a release that moves; a later download is a different build and can give different patients. To rebuild exactly, use the jar with the fingerprint above, or build Synthea from commit d9d07a6.

```
java -Dsun.jnu.encoding=UTF-8 -Dfile.encoding=UTF-8 -jar tools/synthea-with-dependencies.jar -s 20260910 -cs 20260910 -r 20260815 -e 20260815 -p 100 -a 55-90 --exporter.fhir.export true --exporter.fhir.use_us_core_ig true --exporter.baseDirectory ./data/synthea/output/ California
python3 eval/tools/list_patients.py --pick 20 > data/golden/patients.txt
python3 eval/tools/extract_baseline.py --from-list data/golden/patients.txt
bash eval/tools/rebuild_golden.sh
for c in data/smoke/case_00 data/golden/case_*/; do bash eval/tools/validate.sh "${c%/}"; done
```

Synthea build d9d07a6 on Java 21 gives the patients committed here; another Java version can give slightly different patients from the same seeds. On Linux, `-Dsun.jnu.encoding=UTF-8` is needed so patients with accented names are saved; a Mac uses UTF-8 already.

The validator downloads the FHIR definitions it needs from packages.fhir.org on its first run. Each validator run takes about a minute.
