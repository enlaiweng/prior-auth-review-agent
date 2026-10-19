# Practice cases

Two cases for learning to label, **not part of the golden set**. They are built exactly like the golden cases (a facts-only `case_spec.yaml`, a `note.md`, a `bundle.json` made by `eval/tools/render_case.py`, and a `case_page.md`), so practicing on them is practicing on the real format. Each also has an `answer.yaml`: a worked answer with the reasoning for every criterion and the routing, written from the criteria (docs/EVAL_PLAN.md, Criterion inventory) and the routing rules (docs/CHARTER.md) only.

| Case | What it practices |
|---|---|
| `practice_a` | Radiating leg pain that is not a red flag; counting four weeks of conservative care from structured dates; empty evidence when there is no earlier imaging; an approval resting on C2 |
| `practice_b` | A red flag mentioned only in the visit note, which makes C1 undeterminable and routes the case even when everything else would support approval; conditions in the record that are not on the red-flag list |

How to use them: eval/labeling/TRAINING.md, then the practice page `eval/labeling/training.html`, which shows each case, the same form as the labeling page, and a **Check my answers** button. Practice answers are kept in the browser under their own name, apart from the real labels, and the practice page has no download.

The two patients come from `data/golden/patients.txt` but are not used by any golden case (`practice_a`: 461a7e63; `practice_b`: ba1a5e29). If the golden set ever grows, pick other patients for new cases. The agent never runs on these cases, and they are never used to tune or score it.

Rebuilt by `bash eval/tools/rebuild_golden.sh`, and checked by the Validate golden set workflow like the golden cases.
