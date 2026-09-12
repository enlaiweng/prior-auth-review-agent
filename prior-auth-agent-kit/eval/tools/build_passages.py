#!/usr/bin/env python3
"""Split data/policy/L34220.md into citable passages, verbatim, tagged by criterion.

Usage: python3 eval/tools/build_passages.py
Writes data/policy/passages.json:
  {"lcd_id": "L34220", "source_revision": "2025-10-23", "retrieved": "...", "passages": [
     {"id": "L34220-01", "criterion": "C1|C2|C3|C4|context", "text": "<verbatim>", "section": "..."}]}
Every non-empty paragraph and every bullet after the "---" separator becomes one passage.
Criterion tags come from keyword rules below; review them by hand once.
"""
import json, re, os

SRC = "data/policy/L34220.md"
OUT = "data/policy/passages.json"

RULES = [
    ("C1", [r"red[- ]flag", r"Major trauma", r"Minor trauma", r"History of cancer", r"^Fever$", r"^Chills$",
            r"weight loss", r"bacterial infection", r"IV drug", r"Immune suppression", r"supine or at night",
            r"Saddle anesthesia", r"bladder dysfunction", r"neurologic deficit", r"anal sphincter",
            r"perineal sensory", r"motor weakness", r"nerve root compromise", r"suspected tumor"]),
    ("C2", [r"conservative management", r"four weeks", r"first month of symptoms", r"after 1 month", r"do not improve within"]),
    ("C3", [r"medical decision-making", r"affect the treatment choices", r"surgical intervention or other aggressive treatment", r"not under consideration"]),
    ("C4", [r"duplication of other imaging", r"complementary to a lumbar CT", r"need for both studies"]),
]


def tag(text):
    # Paragraphs about the conservative-therapy rule also mention "red flag"; check C2, C3, C4 before C1.
    order = ["C2", "C3", "C4", "C1"]
    rules = dict(RULES)
    for c in order:
        if any(re.search(pat, text, re.I) for pat in rules[c]):
            return c
    return "context"


def main():
    src = open(SRC).read()
    header, _, body = src.partition("\n---\n")
    retrieved = re.search(r"Retrieved: (\S+)", header)
    rev = re.search(r"Revision effective date: (\S+)", header)
    passages, section, n = [], "", 0
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):
            section = block.lstrip("# ").strip()
            continue
        lines = [l for l in block.splitlines() if l.strip()]
        if all(l.lstrip().startswith("*") for l in lines):
            for l in lines:
                n += 1
                t = l.lstrip("* ").strip()
                passages.append({"id": f"L34220-{n:02d}", "criterion": tag(t), "text": t, "section": section})
        else:
            n += 1
            t = " ".join(l.strip() for l in lines)
            passages.append({"id": f"L34220-{n:02d}", "criterion": tag(t), "text": t, "section": section})
    out = {"lcd_id": "L34220", "source_revision": rev.group(1) if rev else "", "retrieved": retrieved.group(1) if retrieved else "",
           "passages": passages}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)
    from collections import Counter
    print(f"wrote {OUT}: {len(passages)} passages", dict(Counter(p['criterion'] for p in passages)))


if __name__ == "__main__":
    main()
