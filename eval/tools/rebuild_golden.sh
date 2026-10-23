#!/bin/bash
# Rebuild everything in the golden set that is made from the committed specs, notes, and baselines:
# the fairness pairs, every bundle, the case pages, the labeling page, and the third reader's prompts;
# then the two practice cases and the practice page (eval/labeling/training.html), and the online labeling site's
# content module (labeling-site/src/content.generated.js).
# Run from the repository root:  bash eval/tools/rebuild_golden.sh
# The "Validate golden set" workflow runs this and then checks that nothing changed, so a committed file
# can never be out of date with the spec or note it was made from. Generating the patients and baselines
# needs Synthea and is described in data/golden/README.md.
set -euo pipefail
python3 eval/tools/normalize_note.py --check
python3 eval/tools/make_pair.py sex data/golden/case_01 --given "Dale50 Oliver319"
python3 eval/tools/make_pair.py race data/golden/case_09
python3 eval/tools/render_case.py data/smoke/case_00 > /dev/null
for c in data/golden/case_*/; do
  python3 eval/tools/render_case.py "${c%/}" > /dev/null
done
python3 eval/tools/build_case_pages.py > /dev/null
python3 eval/tools/build_third_reader_prompts.py > /dev/null
for c in data/practice/practice_*/; do
  python3 eval/tools/render_case.py "${c%/}" > /dev/null
done
python3 eval/tools/build_training_page.py > /dev/null
python3 labeling-site/build_content.py > /dev/null
echo "rebuilt: pairs, $(ls -d data/golden/case_*/ | wc -l | tr -d ' ') bundles plus the smoke case, case pages, labeling page, prompts, $(ls -d data/practice/practice_*/ | wc -l | tr -d ' ') practice cases, practice page, labeling site content"
