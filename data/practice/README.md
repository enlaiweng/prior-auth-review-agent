# Practice cases

Two cases for learning to label, **not part of the golden set**. They are built exactly like the golden cases (a facts-only `case_spec.yaml`, a `note.md`, a `bundle.json` made by `eval/tools/render_case.py`, and a `case_page.md`), so practicing on them is practicing on the real format. Each also has an `answer.yaml`: a worked answer with the reasoning for every criterion and the routing, written from the criteria (docs/EVAL_PLAN.md, Criterion inventory) and the routing rules (docs/CHARTER.md) only. `practice_a` also has a `walkthrough.yaml`: a guided walkthrough that labels the case one step at a time, shown on the practice page with the record and form highlighted at each step, and written out at the end of eval/labeling/TRAINING.md. The build checks that every step that says what to click agrees with `answer.yaml`.

| Case | What it practices |
|---|---|
| `practice_a` | The guided walkthrough: reading a record from top to bottom and answering each question in turn. Also: radiating leg pain that is not a red flag, even with a radiculopathy diagnosis on file; counting four weeks of conservative care from structured dates; empty evidence when there is no earlier imaging; an approval resting on C2 |
| `practice_b` | A red flag mentioned only in the visit note, which makes C1 undeterminable: it can't carry an approval, and it doesn't block the approval C2 carries (ADR-12); leg symptoms with a normal nerve exam |

How to use them: eval/labeling/TRAINING.md, then the practice page `eval/labeling/training.html`, which shows each case, the same form as the labeling page, a **Start the guided walkthrough** button on Practice A, and a **Check my answers** button. Practice answers are kept in the browser under their own name, apart from the real labels, and the practice page has no download.

The two patients come from `data/golden/patients.txt` but are not used by any golden case: 8f48ea64 for `practice_a` and ba1a5e29 for `practice_b`. Each practice case keeps only the patient's Patient entry (`baselines/*-practice.json`); the patients' other conditions and medications were left out, to keep the cases simple. If the golden set ever grows, pick other patients for new cases. To remake a practice baseline (shown for practice_a; use ba1a5e29-bd6d-1385-6e12-3a099fc0b84f for practice_b):

```
python3 -c "import json; d=json.load(open('data/golden/baselines/8f48ea64-12eb-a55e-c747-42fd4dab5908.json')); open('data/practice/baselines/8f48ea64-12eb-a55e-c747-42fd4dab5908-practice.json','w').write(json.dumps([r for r in d if r['resourceType']=='Patient'], indent=1)+'\n')"
```

The agent never runs on these cases, and they are never used to tune or score it.

Rebuilt by `bash eval/tools/rebuild_golden.sh`, and checked by the Validate golden set workflow like the golden cases.
