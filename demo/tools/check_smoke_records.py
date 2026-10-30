#!/usr/bin/env python3
"""Checks the records of the demo's smoke tests (docs/smoke-tests/README.md; docs/RUNBOOK.md, Deploy).

Usage (from the repository root):
  python3 demo/tools/check_smoke_records.py                       every record against its own saved page
  python3 demo/tools/check_smoke_records.py --new RECORD.md ...   also checks these records against the repository

A record is a Markdown file in docs/smoke-tests/ named YYYY-MM-DD-....md, with a YAML header between two "---" lines,
plus the text of the demo page saved at the time.

Every record, every time (it depends only on the record and its saved page, so a merged record stays valid when the
repository moves on):
  - the header has exactly the expected fields, with well-formed values, and its date matches the file name;
  - the saved page agrees with the header: the same agent, spec, model, case, mode, run time, the outcome shown under
    "Live run, just now", and each criterion's status, in the words the demo uses;
  - every id the live run cited is an entry in the saved page's record, and the passcode box is masked;
  - in checklist mode the routing is "route";
  - every saved page in the folder belongs to a record.

Records named with --new (in the Demo checks, the records a pull request adds), against the repository as it is then:
  - the agent version and spec fingerprint appear together on one row of docs/CHANGELOG.md;
  - the case exists, has final labels, and is not a held-out case (those never run live);
  - "outcome: pass" only when every criterion matches the final labels, the routing is right for the mode (route in
    checklist mode, the final label's routing with approvals on) and the citations rendered; "fail" only otherwise.
It does not check the demo's other live-run limits (demo/live_scope.json), which change over time.
It prints every problem it finds and exits 1, or prints one line per record and exits 0.
"""
import argparse, datetime, os, re, sys

import yaml

FOLDER = "docs/smoke-tests"
CRITERIA = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]
STATUSES = ("supported", "unsupported", "undeterminable")
# The words the demo's viewer shows (demo/pages/index.html, OUTCOME, STATUS, and the live result's heading).
OUTCOME_WORDS = {"approve": "Approve", "request": "Request one document", "route": "Send to physician review"}
STATUS_WORDS = {"supported": "Met", "unsupported": "Not met", "undeterminable": "Can't tell from the record"}
LIVE_HEADING = "Live run, just now"
RECORD_HEADING = "The record"
REQUIRED = {"date", "run_by", "deploy", "mode", "agent_version", "spec", "model", "case", "run_seconds", "routing",
            "criteria", "citations_render", "outcome", "page_text"}
OPTIONAL = {"time", "notes"}
CITED_ID = re.compile(r"[A-Z][A-Za-z]+/[A-Za-z0-9.-]+|note:p\d+")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def header(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def held_out(root):
    m = re.search(r"export const HELD_OUT = \[([^\]]*)\];", read(os.path.join(root, "eval/run_agent.mjs")))
    if not m:
        raise SystemExit("eval/run_agent.mjs no longer lists HELD_OUT; cannot check smoke records")
    return set(re.findall(r'"(case_\d\d)"', m.group(1)))


def changelog_has(root, version, spec):
    rows = read(os.path.join(root, "docs/CHANGELOG.md")).splitlines()
    return any(re.search(r"\|\s*" + re.escape(version) + r"\s*\|", r) and spec in r for r in rows)


def next_line(lines, start):
    for line in lines[start:]:
        if line.strip():
            return line.strip()
    return None


def live_part(page):
    """The live result: from its heading to the record listing. Returns (live lines, record listing lines)."""
    lines = page.splitlines()
    if LIVE_HEADING not in lines:
        return None, None
    i = lines.index(LIVE_HEADING)
    j = lines.index(RECORD_HEADING, i) if RECORD_HEADING in lines[i:] else len(lines)
    return lines[i:j], lines[j:]


def is_text(v):
    return isinstance(v, str) and v.strip() != ""


def form_problems(name, h):
    out = []
    date = h["date"]
    if type(date) is not datetime.date:   # a datetime (with a time) is a subclass; refuse it too
        out.append(f"{name}: date must be written YYYY-MM-DD")
    else:
        if not name.startswith(date.isoformat() + "-"):
            out.append(f"{name}: the file name must start with the record's date, {date.isoformat()}")
        if date > datetime.date.today() + datetime.timedelta(days=1):
            out.append(f"{name}: the date is in the future")
    if not is_text(h["run_by"]) or len(h["run_by"].split()) < 2:
        out.append(f"{name}: run_by needs the full name of the person who ran the test")
    if not is_text(h["deploy"]):
        out.append(f"{name}: deploy must say which deployment was tested")
    if h["mode"] not in ("checklist", "approvals_on") or not isinstance(h["mode"], str):
        out.append(f"{name}: mode must be checklist or approvals_on")
    if not isinstance(h["agent_version"], str) or not re.fullmatch(r"agent-[0-9][0-9A-Za-z.-]*", h["agent_version"]):
        out.append(f"{name}: agent_version must look like agent-0.2")
    if not isinstance(h["spec"], str) or not re.fullmatch(r"[0-9a-f]{12}", h["spec"]):
        out.append(f"{name}: spec must be the first 12 characters of the spec fingerprint, as the demo shows it")
    if not is_text(h["model"]):
        out.append(f"{name}: model is empty")
    if not isinstance(h["case"], str) or not re.fullmatch(r"case_\d\d", h["case"]):
        out.append(f"{name}: case must look like case_01")
    secs = h["run_seconds"]
    if type(secs) is not int or not 1 <= secs <= 240:
        out.append(f"{name}: run_seconds must be a whole number from 1 to 240 (a live run gives up after four minutes)")
    if not isinstance(h["routing"], str) or h["routing"] not in OUTCOME_WORDS:
        out.append(f"{name}: routing must be approve, request, or route")
    crit = h["criteria"]
    if not isinstance(crit, dict) or set(crit) != set(CRITERIA):
        out.append(f"{name}: criteria must list exactly {', '.join(CRITERIA)}")
    elif any(not isinstance(v, str) or v not in STATUSES for v in crit.values()):
        out.append(f"{name}: each criterion must be supported, unsupported, or undeterminable")
    if h["citations_render"] not in (True, False) or not isinstance(h["citations_render"], bool):
        out.append(f"{name}: citations_render must be yes or no")
    if not isinstance(h["outcome"], str) or h["outcome"] not in ("pass", "fail"):
        out.append(f"{name}: outcome must be pass or fail")
    if not isinstance(h["page_text"], str) or os.path.basename(h["page_text"]) != h["page_text"]:
        out.append(f"{name}: page_text must name a file saved next to the record")
    return out


def page_problems(name, h, page):
    out = []
    version, spec, model, crit = h["agent_version"], h["spec"], h["model"], h["criteria"]
    footer = f"Agent {version} (spec {spec}), model {model}."
    if footer not in page:
        out.append(f"{name}: the saved page does not show \"{footer}\"")
    num = h["case"].split("_")[1]
    if f"Claim/case{num}-claim" not in page:
        out.append(f"{name}: the saved page is not {h['case']}'s record")
    if h["mode"] == "checklist" and "Checklist mode is on" not in page:
        out.append(f"{name}: the saved page does not say checklist mode was on")
    if h["mode"] == "approvals_on" and "Checklist mode is on" in page:
        out.append(f"{name}: the saved page says checklist mode was on, but the record says approvals_on")
    if f"Done in {h['run_seconds']} s." not in page:
        out.append(f"{name}: the saved page does not show \"Done in {h['run_seconds']} s.\"")
    if re.search("•{4,}", page):
        out.append(f"{name}: the saved page shows the passcode box's dots, which give away its length; replace them with [masked]")
    live, listing = live_part(page)
    if live is None:
        out.append(f"{name}: the saved page shows no \"{LIVE_HEADING}\" result")
        return out
    shown = next_line(live, 1)
    if shown != OUTCOME_WORDS[h["routing"]]:
        out.append(f"{name}: the live result shows the outcome {shown!r}, the record says {h['routing']} "
                   f"({OUTCOME_WORDS[h['routing']]!r})")
    for i, c in enumerate(CRITERIA, 1):
        heads = [k for k, line in enumerate(live) if line.startswith(f"C{i}. ")]
        got = next_line(live, heads[0] + 1) if heads else None
        if got != STATUS_WORDS[crit[c]]:
            out.append(f"{name}: the live result shows C{i} as {got!r}, the record says {crit[c]} ({STATUS_WORDS[crit[c]]!r})")
    cited = [line.strip() for line in live if CITED_ID.fullmatch(line.strip())]
    listed = {line.split()[0] for line in listing if line.strip()}
    missing = sorted(set(c for c in cited if c not in listed))
    if missing:
        out.append(f"{name}: the live result cites ids that are not in the saved record: {', '.join(missing)}")
    if h["citations_render"] is True and not cited:
        out.append(f"{name}: citations_render is yes, but the live result cites no record entry")
    return out


def repository_problems(root, name, h):
    out = []
    if not changelog_has(root, h["agent_version"], h["spec"]):
        out.append(f"{name}: no row of docs/CHANGELOG.md names {h['agent_version']} with spec {h['spec']}")
    case = h["case"]
    if not os.path.isdir(os.path.join(root, "data/golden", case)):
        return out + [f"{name}: there is no {case} in data/golden"]
    if case in held_out(root):
        return out + [f"{name}: {case} is a held-out case; held-out cases never run live on the demo"]
    if not os.path.isfile(os.path.join(root, "data/golden", case, "labels.yaml")):
        return out + [f"{name}: {case} has no final labels yet, so the demo would not have run it live"]
    labels = yaml.safe_load(read(os.path.join(root, "data/golden", case, "labels.yaml")))
    wrong = []
    for c in CRITERIA:
        want = labels["criteria"][c]["status"]
        if h["criteria"][c] != want:
            wrong.append(f"{c} was {h['criteria'][c]}, the final labels say {want}")
    expected = "route" if h["mode"] == "checklist" else labels["expected_routing"]
    if h["routing"] != expected:
        wrong.append(f"routing was {h['routing']}, {h['mode']} mode expects {expected}")
    if h["citations_render"] is not True:
        wrong.append("the citations did not render")
    if h["outcome"] == "pass" and wrong:
        out.append(f"{name}: written as pass, but " + "; ".join(wrong))
    if h["outcome"] == "fail" and not wrong:
        out.append(f"{name}: written as fail, but everything matches the final labels")
    return out


def problems(root, path, new=False):
    name = os.path.basename(path)
    h = header(read(path))
    if h is None:
        return [f"{name}: no YAML header between two '---' lines at the top"]
    keys = set(h)
    out = []
    if REQUIRED - keys:
        out.append(f"{name}: missing fields: {', '.join(sorted(REQUIRED - keys))}")
    if keys - REQUIRED - OPTIONAL:
        out.append(f"{name}: unexpected fields: {', '.join(sorted(keys - REQUIRED - OPTIONAL))}")
    if out:
        return out
    out = form_problems(name, h)
    if out:
        return out
    if h["mode"] == "checklist" and h["routing"] != "route":
        out.append(f"{name}: in checklist mode every case routes, but the record says {h['routing']}")
    page_path = os.path.join(os.path.dirname(path), h["page_text"])
    if not os.path.isfile(page_path):
        return out + [f"{name}: page_text must name a file saved next to the record"]
    out += page_problems(name, h, read(page_path))
    if new:
        out += repository_problems(root, name, h)
    return out


def records(root):
    folder = os.path.join(root, FOLDER)
    if not os.path.isdir(folder):
        return []
    return sorted(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".md") and f != "README.md")


def orphan_pages(root):
    folder = os.path.join(root, FOLDER)
    if not os.path.isdir(folder):
        return []
    used = set()
    for r in records(root):
        h = header(read(r))
        if h and isinstance(h.get("page_text"), str):
            used.add(h["page_text"])
    return [f"{f}: a saved page with no record naming it in page_text"
            for f in sorted(os.listdir(folder)) if f.endswith(".txt") and f not in used]


def main(argv=None, root="."):
    ap = argparse.ArgumentParser(description="Check the demo's smoke test records.")
    ap.add_argument("--new", nargs="*", default=[], help="records to check against the repository too")
    args = ap.parse_args(argv)
    recs = records(root)
    new = set()
    for n in args.new:
        p = os.path.join(root, n) if not os.path.isabs(n) else n
        if os.path.normpath(p) not in [os.path.normpath(r) for r in recs]:
            print(f"::error title=Smoke test record::{n}: not a record in {FOLDER}")
            return 1
        new.add(os.path.normpath(p))
    found = orphan_pages(root)
    for r in recs:
        found += problems(root, r, os.path.normpath(r) in new)
    if found:
        for p in found:
            print("::error title=Smoke test record::" + p)
        return 1
    for r in recs:
        extra = ", the final labels and the changelog" if os.path.normpath(r) in new else ""
        print(f"{os.path.basename(r)}: consistent with its saved page{extra}.")
    if not recs:
        print("No smoke test records yet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
