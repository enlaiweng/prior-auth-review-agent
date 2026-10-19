# Practice cases

Two cases for learning to label, **not part of the golden set**. They are built exactly like the golden cases (a facts-only `case_spec.yaml`, a `note.md`, a `bundle.json` made by `eval/tools/render_case.py`, and a `case_page.md`), so practicing on them is practicing on the real format. Each also has an `answer.yaml`: a worked answer with the reasoning for every criterion and the routing, written from the criteria (docs/EVAL_PLAN.md, Criterion inventory) and the routing rules (docs/CHARTER.md) only.

| Case | What it practices |
|---|---|
| `practice_a` | Radiating leg pain that is not a red flag, even with a radiculopathy diagnosis on file; counting four weeks of conservative care from structured dates; empty evidence when there is no earlier imaging; an approval resting on C2 |
| `practice_b` | A red flag mentioned only in the visit note, which makes C1 undeterminable and routes the case even when everything else would support approval; conditions in the record that are not on the red-flag list |

How to use them: eval/labeling/TRAINING.md, then the practice page `eval/labeling/training.html`, which shows each case, the same form as the labeling page, and a **Check my answers** button. Practice answers are kept in the browser under their own name, apart from the real labels, and the practice page has no download.

The two patients come from `data/golden/patients.txt` but are not used by any golden case. `practice_b` uses patient 461a7e63's baseline as it is. `practice_a` uses patient 8f48ea64 with only the Patient entry kept (`baselines/8f48ea64-12eb-a55e-c747-42fd4dab5908-practice.json`; the diabetes conditions and their medications were left out), so the practice cases never touch a question the criteria leave open, such as whether a chronic condition counts as a red flag. If the golden set ever grows, pick other patients for new cases. To remake the practice baseline:

```
python3 -c "import json; d=json.load(open('data/golden/baselines/8f48ea64-12eb-a55e-c747-42fd4dab5908.json')); open('data/practice/baselines/8f48ea64-12eb-a55e-c747-42fd4dab5908-practice.json','w').write(json.dumps([r for r in d if r['resourceType']=='Patient'], indent=1)+'\n')"
``` The agent never runs on these cases, and they are never used to tune or score it.

Rebuilt by `bash eval/tools/rebuild_golden.sh`, and checked by the Validate golden set workflow like the golden cases.
