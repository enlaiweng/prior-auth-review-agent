#!/usr/bin/env python3
"""Assemble the third reader's prompt for each golden case, so the exact text is fixed before labeling.

Usage (from the repository root): python3 eval/tools/build_third_reader_prompts.py
Reads eval/third_reader/prompt_template.md and fills it with:
  the policy text (data/policy/L34220.md), the criteria (docs/EVAL_PLAN.md, Criterion inventory),
  the three outcomes (docs/CHARTER.md, authority statement), the case page (data/golden/case_NN/case_page.md),
  and the same status and evidence legend the labeling page shows.
Writes eval/third_reader/prompts/case_NN.txt, plus prompts.sha256 with one fingerprint per prompt.
Nothing else goes into a prompt: no design notes, no flags, no intended answers (EVAL_PLAN.md, How the answer key is made).
"""
import glob, hashlib, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from build_case_pages import LEGEND, criteria_text, outputs_text  # same text the labeling page shows

TEMPLATE = "eval/third_reader/prompt_template.md"
OUT_DIR = "eval/third_reader/prompts"


def main():
    template = open(TEMPLATE).read()
    policy = open("data/policy/L34220.md").read().strip()
    criteria, outcomes = criteria_text(), outputs_text()
    os.makedirs(OUT_DIR, exist_ok=True)
    sums = []
    for case_dir in sorted(glob.glob("data/golden/case_[0-9][0-9]")):
        case_id = os.path.basename(case_dir)
        page = open(os.path.join(case_dir, "case_page.md")).read().strip()
        text = (template.replace("{{POLICY}}", policy).replace("{{CRITERIA}}", criteria)
                .replace("{{OUTCOMES}}", outcomes).replace("{{CASE_PAGE}}", page).replace("{{CASE_ID}}", case_id).replace("{{LEGEND}}", LEGEND))
        assert "{{" not in text, f"unfilled marker in {case_id}"
        path = os.path.join(OUT_DIR, f"{case_id}.txt")
        open(path, "w").write(text)
        sums.append(f"{hashlib.sha256(text.encode()).hexdigest()}  {case_id}.txt")
        print("wrote", path)
    open(os.path.join(OUT_DIR, "prompts.sha256"), "w").write("\n".join(sums) + "\n")


if __name__ == "__main__":
    main()
