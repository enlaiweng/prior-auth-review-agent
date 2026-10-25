#!/usr/bin/env python3
"""Write a case's final labels (labels.yaml) from its blind labels plus the owner's settling decisions.

Usage (from the repository root):
  python3 eval/tools/settle.py DECISIONS.yaml

DECISIONS.yaml lists, per case, the date and the changes the owner decided, each with his reason:

  settled_on: 2026-10-25
  cases:
    case_04:
      changes:
        - {field: C1_red_flag.status, to: supported, reason: "..."}
        - {field: C1_red_flag.evidence, to: [Observation/case04-obs-01], reason: "..."}
        - {field: expected_routing, to: approve, reason: "..."}
        - {field: named_gap, to: null, reason: "..."}
    case_01:
      changes: []          # final labels are the blind labels unchanged

Fields are CRIT.status, CRIT.evidence, expected_routing, and named_gap ({criterion, missing} or null).
Everything not listed is copied from labels_blind.yaml exactly. The output's changes_from_blind records each change
with its old value, so the file shows what moved and why. eval/tools/check_labels.py confirms that changes_from_blind
matches the real difference from labels_blind.yaml, and that the routing is one the agent's routing rule can produce.
Refuses to overwrite an existing labels.yaml.
"""
import os, sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "eval", "tools"))
os.chdir(ROOT)
from build_case_pages import case_view  # noqa: E402

CRIT = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]
HEADER = [
    "# Final labels for one case (Amendment 2): Enlai Weng's blind labels with the disagreements settled against the",
    "# policy text. labels_blind.yaml stays unchanged; every change from it is listed under changes_from_blind with its reason.",
    "# Written by eval/tools/settle.py from the owner's decisions; check_labels.py confirms the list matches the real difference.",
]


def q(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def page_order(case):
    v = case_view(os.path.join("data/golden", case))
    out = [v["request"]["id"], v["patient"]["id"]]
    for s in v["sections"]:
        out += [i["id"] for i in s["items"]]
    out.append(v["note"]["id"])
    out += [p["id"] for p in v["note"]["paragraphs"]]
    return out


def fmt_value(field, v):
    if field == "named_gap":
        return "null" if v is None else "{criterion: " + v["criterion"] + ", missing: " + q(v["missing"]) + "}"
    if field.endswith(".evidence"):
        return "[" + ", ".join(v) + "]"
    return str(v)


def get(lab, field):
    if field in ("expected_routing", "named_gap"):
        return lab.get(field)
    k, part = field.split(".")
    return lab["criteria"][k][part]


def settle(case, changes, settled_on):
    with open(os.path.join("data/golden", case, "labels_blind.yaml"), encoding="utf-8") as f:
        blind = yaml.safe_load(f)
    order = page_order(case)
    final = {"criteria": {k: {"status": blind["criteria"][k]["status"], "evidence": list(blind["criteria"][k]["evidence"] or [])} for k in CRIT},
             "expected_routing": blind["expected_routing"], "named_gap": blind.get("named_gap")}
    log = []
    seen = set()
    for ch in changes:
        field, to, reason = ch["field"], ch.get("to"), str(ch.get("reason") or "").strip()
        if field in seen:
            raise SystemExit(f"{case}: {field} is changed twice")
        seen.add(field)
        if not reason:
            raise SystemExit(f"{case}: {field} has no reason")
        if field.endswith(".evidence"):
            bad = [e for e in to if e not in order]
            if bad:
                raise SystemExit(f"{case}: {field} cites ids not on the case page: {bad}")
            to = sorted(to, key=order.index)
        old = get(blind, field)
        if field.endswith(".evidence"):
            old = sorted(old or [], key=order.index)
        if old == to:
            raise SystemExit(f"{case}: {field} is listed as a change but equals the blind label")
        if field in ("expected_routing", "named_gap"):
            final[field] = to
        else:
            k, part = field.split(".")
            final["criteria"][k][part] = to
        log.append((field, old, to, reason))
    L = list(HEADER)
    L.append("case_id: " + case)
    L.append("settled_on: " + settled_on)
    L.append("criteria:")
    for k in CRIT:
        x = final["criteria"][k]
        L.append("  " + (k + ":").ljust(25) + "{status: " + x["status"] + ", evidence: [" + ", ".join(sorted(x["evidence"], key=order.index)) + "]}")
    L.append("expected_routing: " + final["expected_routing"])
    L.append("named_gap: " + fmt_value("named_gap", final["named_gap"]))
    if not log:
        L.append("changes_from_blind: []")
    else:
        L.append("changes_from_blind:")
        for field, old, to, reason in log:
            L.append("  - field: " + field)
            L.append("    from: " + (q(fmt_value(field, old)) if field == "named_gap" else fmt_value(field, old)))
            L.append("    to: " + (q(fmt_value(field, to)) if field == "named_gap" else fmt_value(field, to)))
            L.append("    reason: " + q(reason))
    return "\n".join(L) + "\n"


def main(argv):
    if len(argv) != 1:
        raise SystemExit(__doc__)
    with open(argv[0], encoding="utf-8") as f:
        d = yaml.safe_load(f)
    out = {}
    for case, spec in d["cases"].items():
        p = os.path.join("data/golden", case, "labels.yaml")
        if os.path.exists(p):
            raise SystemExit(f"{p} already exists; final labels are changed by hand, with a reason, not regenerated")
        out[p] = settle(case, spec.get("changes") or [], str(d["settled_on"]))
    for p, text in out.items():
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print("wrote", p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
