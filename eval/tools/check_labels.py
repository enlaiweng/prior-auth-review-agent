#!/usr/bin/env python3
"""Check that label files have the right shape, and cite only ids that exist in their case.

Usage (from the repository root):
  python3 eval/tools/check_labels.py                    check every label file in the golden set and the smoke case
  python3 eval/tools/check_labels.py FILE [FILE ...]    check only these files
  python3 eval/tools/check_labels.py --require-blind    also require a complete labels_blind.yaml in all twelve golden cases

Label files: labels_blind.yaml (the owner's blind labels), labels_gemini.yaml (the third reader's), and labels.yaml
(final labels). The format is the one in data/golden/_template/. This script checks form only: every criterion has a
status, every evidence id is on the case page, the routing is one of the three outputs, and a request names its gap.
For blind and Gemini labels it never compares labels with each other or with anything else, so it reveals nothing\nabout any answer. For final labels (labels.yaml, written after the reveal) it also checks that the routing is one the\nagent's routing rule can produce from the statuses, and that changes_from_blind lists exactly what differs from the\nblind labels.
Exit code 0 when every file passes, 1 otherwise.
"""
import datetime, glob, os, sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
from build_case_pages import case_view  # the same ids the case pages and the labeling page show

CRITERIA = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]
STATUSES = {"supported", "unsupported", "undeterminable"}
ROUTINGS = {"approve", "request", "route"}
GAP_CRITERIA = {"C1", "C2", "C3", "C4"}
GOLDEN = "data/golden/case_[0-9][0-9]"
NAMES = ("labels_blind.yaml", "labels_gemini.yaml", "labels.yaml")


def citable_ids(case_dir):
    """Every id a label may cite in this case: the request, the patient, each record item, the note, its paragraphs."""
    v = case_view(case_dir)
    out = {v["request"]["id"], v["patient"]["id"], v["note"]["id"]}
    for s in v["sections"]:
        out.update(i["id"] for i in s["items"])
    out.update(p["id"] for p in v["note"]["paragraphs"])
    return out


def is_date(x):
    if isinstance(x, datetime.date):
        return True
    try:
        datetime.date.fromisoformat(str(x))
        return True
    except ValueError:
        return False


def problems(data, case_dir, filename):
    """Return a list of plain-language problems with one parsed label file (empty when it passes)."""
    out = []
    case = os.path.basename(case_dir)
    if not isinstance(data, dict):
        return ["the file is not a set of keys and values"]
    if data.get("case_id") != case:
        out.append(f"case_id is {data.get('case_id')!r}, expected {case}")
    if filename in ("labels_blind.yaml", "labels_gemini.yaml"):
        if not is_date(data.get("labeled_on")):
            out.append("labeled_on is missing or not a date (YYYY-MM-DD)")
    crit = data.get("criteria")
    if not isinstance(crit, dict):
        out.append("criteria is missing")
        crit = {}
    extra = set(crit) - set(CRITERIA)
    if extra:
        out.append("unknown criteria: " + ", ".join(sorted(extra)))
    ids = citable_ids(case_dir)
    for k in CRITERIA:
        c = crit.get(k)
        if not isinstance(c, dict):
            out.append(f"{k} is missing")
            continue
        if c.get("status") not in STATUSES:
            out.append(f"{k} status is {c.get('status')!r}; it must be supported, unsupported, or undeterminable")
        ev = c.get("evidence")
        if not isinstance(ev, list):
            out.append(f"{k} evidence is not a list")
            continue
        for e in ev:
            if not isinstance(e, str) or e not in ids:
                out.append(f"{k} cites {e!r}, which is not an id on this case's page")
        if len(set(map(str, ev))) != len(ev):
            out.append(f"{k} cites the same id twice")
    routing = data.get("expected_routing")
    if routing not in ROUTINGS:
        out.append(f"expected_routing is {routing!r}; it must be approve, request, or route")
    gap = data.get("named_gap")
    if routing == "request":
        if not isinstance(gap, dict) or gap.get("criterion") not in GAP_CRITERIA or not str(gap.get("missing") or "").strip():
            out.append("a request needs named_gap: {criterion: C1 to C4, missing: what is missing}")
    elif gap is not None:
        out.append("named_gap must be null unless the routing is request")
    return out


def _record_entry(ids):
    """True when the evidence includes something other than the visit note (a note paragraph or the note itself)."""
    return any(not str(e).startswith(("note:", "DocumentReference/")) for e in ids or [])


def approvable(crit):
    s = {k: (crit.get(k) or {}).get("status") for k in CRITERIA}
    ev = {k: (crit.get(k) or {}).get("evidence") for k in CRITERIA}
    carried = (s["C1_red_flag"] == "supported" and _record_entry(ev["C1_red_flag"])) or \
              (s["C2_conservative_4wk"] == "supported" and _record_entry(ev["C2_conservative_4wk"]))
    return s["C3_informs_management"] == "supported" and s["C4_no_duplicate_imaging"] == "supported" and carried


def routing_problems(data):
    """Final labels only: the routing must be one the agent's fixed routing rule can produce from these statuses
    (EVAL_PLAN.md, Criterion inventory; TRAINING.md, Routing the case; ARCHITECTURE.md, ADR-10 and ADR-12). Otherwise
    the agent would be scored wrong for following its own rule."""
    crit = data.get("criteria") or {}
    routing, gap = data.get("expected_routing"), data.get("named_gap")
    s = {k: (crit.get(k) or {}).get("status") for k in CRITERIA}
    if approvable(crit):
        return [] if routing == "approve" else [f"the statuses make the case approvable, so the routing must be approve, not {routing}"]
    if routing == "approve":
        return ["approve needs C3 and C4 supported and C1 or C2 supported with a cited record entry other than the note"]
    if routing == "request":
        out = []
        g = gap.get("criterion") if isinstance(gap, dict) else None
        key = {"C1": "C1_red_flag", "C2": "C2_conservative_4wk", "C3": "C3_informs_management", "C4": "C4_no_duplicate_imaging"}.get(g)
        if g == "C1":
            out.append("a request is never for C1; a red flag question routes")
        if s["C1_red_flag"] == "undeterminable":
            out.append("C1 is undeterminable and the case can't be approved, so it routes rather than requesting")
        if key and s[key] != "undeterminable":
            out.append(f"a request's criterion must be undeterminable; {g} is {s[key]}")
        if key and g != "C1":
            trial = {k: dict(v) for k, v in crit.items()}
            trial[key]["status"] = "supported"
            if key in ("C1_red_flag", "C2_conservative_4wk") and not _record_entry(trial[key].get("evidence")):
                trial[key]["evidence"] = ["Procedure/placeholder"]
            if not approvable(trial):
                out.append(f"even if the requested document settled {g}, the case could not be approved, so it routes")
        return out
    return []


def change_problems(data, blind):
    """Final labels only: changes_from_blind must list exactly the fields that differ from labels_blind.yaml, each
    with a reason."""
    def val(d, field):
        if field in ("expected_routing", "named_gap"):
            v = d.get(field)
            return {"criterion": v["criterion"], "missing": str(v["missing"]).strip()} if isinstance(v, dict) else v
        k, part = field.split(".")
        v = (d.get("criteria") or {}).get(k, {}).get(part)
        return sorted(v or []) if part == "evidence" else v
    fields = [f"{k}.{p}" for k in CRITERIA for p in ("status", "evidence")] + ["expected_routing", "named_gap"]
    actual = {f for f in fields if val(data, f) != val(blind, f)}
    listed = data.get("changes_from_blind")
    if not isinstance(listed, list):
        return ["changes_from_blind is missing (use [] when nothing changed)"]
    out = []
    names = [c.get("field") if isinstance(c, dict) else None for c in listed]
    for c in listed:
        if not isinstance(c, dict) or not str(c.get("reason") or "").strip():
            out.append(f"a change has no reason: {c!r}")
    for f in sorted(actual - set(names)):
        out.append(f"{f} differs from labels_blind.yaml but is not listed in changes_from_blind")
    for f in sorted(set(names) - actual):
        out.append(f"changes_from_blind lists {f}, which does not differ from labels_blind.yaml")
    if len(names) != len(set(names)):
        out.append("changes_from_blind lists a field twice")
    return out


def check_file(path):
    case_dir = os.path.dirname(path)
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        return [f"not valid YAML: {e}"]
    found = problems(data, case_dir, os.path.basename(path))
    blind_path = os.path.join(case_dir, "labels_blind.yaml")
    if os.path.basename(path) == "labels.yaml" and os.path.exists(blind_path) and isinstance(data, dict):
        if not is_date(data.get("settled_on")):
            found.append("settled_on is missing or not a date (YYYY-MM-DD)")
        found += routing_problems(data)
        with open(blind_path, encoding="utf-8") as f:
            found += change_problems(data, yaml.safe_load(f))
    return found


def main(argv):
    require_blind = "--require-blind" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        for d in sorted(glob.glob(GOLDEN)) + ["data/smoke/case_00"]:
            paths += [os.path.join(d, n) for n in NAMES if os.path.exists(os.path.join(d, n))]
    failed = False
    for p in paths:
        found = check_file(p)
        if found:
            failed = True
            print(f"FAIL {p}")
            for f in found:
                print(f"  - {f}")
        else:
            print(f"ok   {p}")
    if require_blind:
        missing = [d for d in sorted(glob.glob(GOLDEN)) if not os.path.exists(os.path.join(d, "labels_blind.yaml"))]
        if missing:
            failed = True
            print("FAIL the blind labels are not all in: missing for " + ", ".join(os.path.basename(m) for m in missing))
        elif not failed:
            print(f"ok   all {len(glob.glob(GOLDEN))} golden cases have complete blind labels")
    if not paths and not require_blind:
        print("no label files found")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
