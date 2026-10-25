#!/usr/bin/env python3
"""Compare the three readers of the golden set, side by side: Enlai's blind labels, Gemini's labels, and Claude's
intended answers (revealed). Writes data/golden/disagreements.md.

Usage (from the repository root):
  python3 eval/tools/compare_readers.py            write the report
  python3 eval/tools/compare_readers.py --check    fail if the committed report differs from what the files produce

Reads, and never changes:
  data/golden/case_NN/labels_blind.yaml     Enlai Weng's blind labels
  data/golden/case_NN/labels_gemini.yaml    the third reader's labels
  data/golden/intended_answers.yaml         Claude's intended answers, as decrypted at the reveal. The file still uses
                                            the old name case_15 for today's case_11 (intended_answers.md, Case numbers);
                                            this script renames it, ids included, before comparing.

This script only counts and lists. It does not decide which reader is right; Enlai settles each disagreement against
the policy text in labels.yaml (EVAL_PLAN.md, How the answer key is made).
"""
import os, sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
OUT = "data/golden/disagreements.md"
CASES = [f"case_{i:02d}" for i in range(1, 13)]
CRIT = [("C1_red_flag", "C1 red flag"), ("C2_conservative_4wk", "C2 conservative care"),
        ("C3_informs_management", "C3 informs management"), ("C4_no_duplicate_imaging", "C4 no duplicate imaging")]
READERS = [("enlai", "Enlai"), ("gemini", "Gemini"), ("intended", "Intended")]
RENAMED = {"case_15": "case_11"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def intended():
    d = load("data/golden/intended_answers.yaml")["cases"]
    out = {}
    for old, v in d.items():
        new = RENAMED.get(old, old)
        if old != new:
            v = yaml.safe_load(yaml.safe_dump(v).replace(old.replace("_", "") + "-", new.replace("_", "") + "-"))
        out[new] = v
    assert sorted(out) == CASES, sorted(out)
    return out


def norm(label):
    """Status, evidence, routing and gap of one reader's label for one case."""
    gap = label.get("named_gap")
    return {
        "status": {k: label["criteria"][k]["status"] for k, _ in CRIT},
        "evidence": {k: list(label["criteria"][k]["evidence"] or []) for k, _ in CRIT},
        "routing": label["expected_routing"],
        "gap": (gap["criterion"], str(gap["missing"]).strip()) if isinstance(gap, dict) else None,
    }


def gather():
    ia = intended()
    data = {}
    for c in CASES:
        data[c] = {
            "enlai": norm(load(f"data/golden/{c}/labels_blind.yaml")),
            "gemini": norm(load(f"data/golden/{c}/labels_gemini.yaml")),
            "intended": norm(ia[c]),
        }
    return data


def pair_counts(data, a, b):
    routing = sum(data[c][a]["routing"] == data[c][b]["routing"] for c in CASES)
    status = sum(data[c][a]["status"][k] == data[c][b]["status"][k] for c in CASES for k, _ in CRIT)
    return routing, status


def report(data):
    L = []
    L.append("# Three readers, side by side")
    L.append("")
    L.append("Made by `eval/tools/compare_readers.py` from the committed label files. It counts and lists; it does not "
             "decide who is right. Enlai settles each disagreement against the policy text and records the final label, "
             "with the reason, in each case's `labels.yaml`.")
    L.append("")
    L.append("- **Enlai**: blind labels (`labels_blind.yaml`), entered on the labeling site on 2026-10-24.")
    L.append("- **Gemini**: the third reader (`labels_gemini.yaml`), gemini-3.8-flash through its API, run 40166566266 on 2026-10-24.")
    L.append("- **Intended**: Claude's intended answers, locked on 2026-10-15 and revealed on 2026-10-25 (`intended_answers.yaml`).")
    L.append("")
    L.append("## Agreement")
    L.append("")
    L.append("| Pair | Same routing (of 12) | Same criterion status (of 48) |")
    L.append("|---|---|---|")
    for a, b in (("enlai", "gemini"), ("enlai", "intended"), ("gemini", "intended")):
        r, s = pair_counts(data, a, b)
        L.append(f"| {dict(READERS)[a]} and {dict(READERS)[b]} | {r} | {s} |")
    allr = sum(len({data[c][x]["routing"] for x, _ in READERS}) == 1 for c in CASES)
    alls = sum(len({data[c][x]["status"][k] for x, _ in READERS}) == 1 for c in CASES for k, _ in CRIT)
    L.append(f"| All three | {allr} | {alls} |")
    L.append("")
    L.append("Evidence is listed below but not counted: the readers were asked to cite what supports each status, and "
             "how much to cite was left to each, so a shorter list is not by itself a disagreement.")
    L.append("")
    L.append("## Cases to settle")
    L.append("")
    split = [c for c in CASES if any(len({data[c][x]["status"][k] for x, _ in READERS}) > 1 for k, _ in CRIT)
             or len({data[c][x]["routing"] for x, _ in READERS}) > 1
             or len({data[c][x]["gap"][0] if data[c][x]["gap"] else None for x, _ in READERS}) > 1]
    same = [c for c in CASES if c not in split]
    L.append("Cases where the readers differ on a status, the routing, or the criterion named in a gap: "
             + (", ".join(c.replace("case_", "") for c in split) if split else "none") + ".")
    L.append("Cases where all three agree on all of those: "
             + (", ".join(c.replace("case_", "") for c in same) if same else "none") + ".")
    L.append("")
    for c in CASES:
        d = data[c]
        L.append(f"## {c.replace('case_', 'Case ')}" + ("" if c in split else " (all three agree)"))
        L.append("")
        L.append("| | Enlai | Gemini | Intended | |")
        L.append("|---|---|---|---|---|")
        for k, name in CRIT:
            vals = [d[x]["status"][k] for x, _ in READERS]
            L.append(f"| {name} | {vals[0]} | {vals[1]} | {vals[2]} | {'' if len(set(vals)) == 1 else 'differs'} |")
        vals = [d[x]["routing"] for x, _ in READERS]
        L.append(f"| **Routing** | **{vals[0]}** | **{vals[1]}** | **{vals[2]}** | {'' if len(set(vals)) == 1 else '**differs**'} |")
        gaps = [d[x]["gap"] for x, _ in READERS]
        if any(gaps):
            cells = [f"{g[0]}: {g[1]}" if g else "none" for g in gaps]
            crit_differ = len({g[0] if g else None for g in gaps}) > 1
            L.append(f"| Gap named | {cells[0]} | {cells[1]} | {cells[2]} | {'differs' if crit_differ else ''} |")
        L.append("")
        L.append("Evidence cited:")
        L.append("")
        for k, name in CRIT:
            ev = {x: d[x]["evidence"][k] for x, _ in READERS}
            if not any(ev.values()):
                L.append(f"- {name}: none cited by any reader")
                continue
            parts = []
            for x, label in READERS:
                parts.append(f"{label} " + (", ".join(f"`{e}`" for e in ev[x]) if ev[x] else "none"))
            L.append(f"- {name}: " + "; ".join(parts))
        L.append("")
    return "\n".join(L).rstrip() + "\n"


def main(argv):
    text = report(gather())
    if "--check" in argv:
        with open(OUT, encoding="utf-8") as f:
            ok = f.read() == text
        print(("ok   " if ok else "FAIL ") + OUT + ("" if ok else " is out of date; run python3 eval/tools/compare_readers.py"))
        return 0 if ok else 1
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
