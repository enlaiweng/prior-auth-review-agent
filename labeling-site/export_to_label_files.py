#!/usr/bin/env python3
"""Turn the labeling site's "Download submitted labels" file into label files in the repository, or check that they match.

Usage (from the repository root):
  python3 labeling-site/export_to_label_files.py EXPORT.json --labeler LABELER_ID --out labels_blind.yaml
      Writes data/golden/case_NN/<out> for every golden case that labeler submitted. Refuses to overwrite a file.
  python3 labeling-site/export_to_label_files.py --verify
      For every export listed in data/golden/site_exports/README.md, rebuilds the label files it produced and fails
      if any committed file differs by a single byte, or if the export itself was changed after it was committed.

Why this exists: labels entered on the site come out as one JSON file holding every labeler's submissions. The
repository keeps one small YAML file per case. This script is the only step between the two, so it does no judging:
it copies each status, evidence id, routing, and gap exactly, in the same layout the labeling page
(eval/labeling/labeling.html, function yaml) writes, so a file made here and one made on the page are identical for
the same answers. Before writing anything it checks that each case the labeler saw on the site is the same case record
the repository holds now (case_sha), so labels can never be attached to a case that has since changed.

labeled_on is the Pacific date of the labeler's last change to that case on the site, the same rule the labeling
page uses (the browser's local date of the last change).
"""
import argparse, datetime, hashlib, json, os, sys
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "eval", "tools"))
sys.path.insert(0, os.path.join(ROOT, "labeling-site"))
os.chdir(ROOT)
import build_case_pages as b  # noqa: E402
from build_content import case_sha  # noqa: E402

CRIT = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]
HEADER = [
    "# Blind labels for one case (Amendment 2): your answers before seeing any other reader's. Never edited after upload.",
    "# status is supported, unsupported, or undeterminable. evidence lists resource ids (for example Procedure/case01-pt-01) or note paragraphs (note:p2).",
    "# expected_routing is approve, request, or route. named_gap is null, or {criterion: C2, missing: what is missing}.",
]
PACIFIC = ZoneInfo("America/Los_Angeles")
EXPORTS_DIR = "data/golden/site_exports"
MANIFEST = os.path.join(EXPORTS_DIR, "README.md")


def yq(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def page_ids(view):
    """The ids in the order the labeling page lists them (function ids in labeling.html)."""
    out = [view["request"]["id"], view["patient"]["id"]]
    for s in view["sections"]:
        out += [i["id"] for i in s["items"]]
    out.append(view["note"]["id"])
    out += [p["id"] for p in view["note"]["paragraphs"]]
    return out


def to_yaml(case, label, labeled_on, order):
    """The same text labeling.html's yaml() writes for these answers."""
    lines = list(HEADER)
    lines.append("case_id: " + case)
    lines.append("labeled_on: " + labeled_on)
    lines.append("criteria:")
    for k in CRIT:
        x = label["criteria"][k]
        ev = sorted(x["evidence"], key=order.index)  # the page keeps evidence in page order
        lines.append("  " + (k + ":").ljust(25) + "{status: " + x["status"] + ", evidence: [" + ", ".join(ev) + "]}")
    r = label["routing"]
    lines.append("expected_routing:" + (" " + r if r else ""))
    if r == "request" and label.get("gap_criterion"):
        lines.append("named_gap: {criterion: " + label["gap_criterion"] + ", missing: " + yq(label["gap_missing"].strip()) + "}")
    else:
        lines.append("named_gap: null")
    return "\n".join(lines) + "\n"


def build(export_path, labeler):
    """Return {path: text} for every golden case this labeler submitted, after checking each case is unchanged."""
    with open(export_path, encoding="utf-8") as f:
        data = json.load(f)
    rows = [r for r in data["labels"] if r["labeler_id"] == labeler and r["kind"] == "golden"]
    if not rows:
        raise SystemExit(f"no submitted golden labels for {labeler} in {export_path}")
    seen, out = set(), {}
    for r in rows:
        case = r["case"]
        if case in seen:
            raise SystemExit(f"{case} appears twice for {labeler}")
        seen.add(case)
        if not r.get("submitted_at"):
            raise SystemExit(f"{case} was not submitted")
        d = os.path.join("data/golden", case)
        view = b.case_view(d)
        if case_sha(view) != r["case_sha"]:
            raise SystemExit(f"{case}: the case the labeler saw (case_sha {r['case_sha'][:12]}) is not the case in the "
                             f"repository now ({case_sha(view)[:12]}). Stop and ask the owner.")
        order = page_ids(view)
        for k in CRIT:
            for e in r["label"]["criteria"][k]["evidence"]:
                if e not in order:
                    raise SystemExit(f"{case} {k} cites {e}, which is not on the case page")
        when = datetime.datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00")).astimezone(PACIFIC).date().isoformat()
        out[os.path.join(d, "labels_blind.yaml")] = to_yaml(case, r["label"], when, order)
    return out


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def manifest_entries():
    """Lines in the manifest's table: | export file | sha256 | labeler id | output file | ..."""
    out = []
    with open(MANIFEST, encoding="utf-8") as f:
        for line in f:
            cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
            if len(cells) >= 4 and cells[0].endswith(".json"):
                out.append(cells[:4])
    return out


def verify():
    on_disk = sorted(n for n in os.listdir(EXPORTS_DIR) if n.lower().endswith(".json")) if os.path.isdir(EXPORTS_DIR) else []
    if not on_disk:
        print("no site exports in the repository")
        return 0
    entries = manifest_entries()
    failed = False
    if not entries:
        print(f"FAIL {MANIFEST} lists no exports, but {len(on_disk)} export file(s) are in {EXPORTS_DIR}")
        return 1
    unlisted = sorted(set(on_disk) - {e[0] for e in entries})
    for n in unlisted:
        print(f"FAIL {os.path.join(EXPORTS_DIR, n)} is not listed in {MANIFEST}")
        failed = True
    for name, digest, labeler, outname in entries:
        path = os.path.join(EXPORTS_DIR, name)
        if not os.path.isfile(path):
            print(f"FAIL {path} is listed in {MANIFEST} but is not in the repository")
            failed = True
            continue
        if sha256(path) != digest:
            print(f"FAIL {path} was changed after it was committed (sha256 differs from the manifest)")
            failed = True
            continue
        files = build(path, labeler)
        for p, text in sorted(files.items()):
            p = os.path.join(os.path.dirname(p), outname)
            try:
                with open(p, encoding="utf-8", newline="") as f:
                    ok = f.read() == text
            except FileNotFoundError:
                ok = False
            print(("ok   " if ok else "FAIL ") + p + ("" if ok else f" does not match what {name} produces"))
            failed |= not ok
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export", nargs="?")
    ap.add_argument("--labeler")
    ap.add_argument("--out", default="labels_blind.yaml")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        return verify()
    if not a.export or not a.labeler:
        ap.error("give EXPORT.json and --labeler, or --verify")
    files = build(a.export, a.labeler)
    for p, text in sorted(files.items()):
        p = os.path.join(os.path.dirname(p), a.out)
        if os.path.exists(p):
            raise SystemExit(f"{p} already exists; label files are never overwritten")
    for p, text in sorted(files.items()):
        p = os.path.join(os.path.dirname(p), a.out)
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print("wrote", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
