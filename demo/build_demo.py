#!/usr/bin/env python3
"""Build the demo's content module from the repository.

Usage (from the repository root): python3 demo/build_demo.py [--out FILE] [--stored-run DIR]

The demo's checks and its deploy workflow run this before every test and every deploy. Its output is not committed
(demo/src/content.generated.js is in .gitignore), so what is deployed is always built from the commit being deployed.

Reads:
  data/golden/case_NN/bundle.json, and the readable record through eval/tools/build_case_pages.py
  data/golden/case_NN/labels.yaml: only whether it exists, never its content. A case runs live only once its final
    labels are in place (the labels-first rule in eval/run_agent.mjs).
  docs/EVAL_PLAN.md and eval/run_agent.mjs: the held-out cases, which never run live; the two must agree
  demo/stored_run.txt: "none", or the folder under eval/runs/ whose decisions the viewer shows
  agent/agent.js and agent/spec.generated.js: the agent version and spec fingerprint the stored decisions must match
  demo/pages/index.html: the viewer
Writes:
  demo/src/content.generated.js

It never reads the content of any label file, the locked intended answers, or Gemini's labels.
"""
import argparse, base64, glob, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "eval", "tools"))
os.chdir(ROOT)
import build_case_pages as b  # noqa: E402

OUT = "demo/src/content.generated.js"
PLAN_SENTENCE = re.compile(r"Held-out cases, 3 of the 12: cases (\d\d), (\d\d), and (\d\d)\.")
# What the viewer shows of a stored decision. The routing is not taken from the file: the Worker decides it again
# from the model's report with the fixed rule, under the mode the demo is in (checklist or approve).
STORED_FIELDS = ("case_id", "agent_version", "spec_sha256", "routing", "named_gap", "checklist_mode", "criteria",
                 "contradictions", "missing_document_suggested", "case_summary", "confidence", "error", "model",
                 "stop_reason", "seconds")


def held_out():
    plan = open("docs/EVAL_PLAN.md", encoding="utf-8").read()
    m = PLAN_SENTENCE.search(plan)
    if not m:
        raise SystemExit("docs/EVAL_PLAN.md no longer names the three held-out cases in the expected sentence; nothing built")
    from_plan = ["case_" + n for n in m.groups()]
    js = open("eval/run_agent.mjs", encoding="utf-8").read()
    m2 = re.search(r'export const HELD_OUT = \[([^\]]*)\];', js)
    from_runner = re.findall(r'"(case_\d\d)"', m2.group(1)) if m2 else None
    if from_runner != from_plan:
        raise SystemExit(f"held-out cases differ: EVAL_PLAN.md {from_plan}, eval/run_agent.mjs {from_runner}; nothing built")
    return from_plan


def agent_identity():
    agent = open("agent/agent.js", encoding="utf-8").read()
    spec = open("agent/spec.generated.js", encoding="utf-8").read()
    version = re.search(r'export const AGENT_VERSION = "([^"]+)";', agent).group(1)
    sha = re.search(r'export const SPEC_SHA256 = "([0-9a-f]{64})";', spec).group(1)
    return version, sha


def stored(run_dir, cases, version, sha):
    """The decisions of one finished run, checked against the agent being deployed. Returns (run, decisions)."""
    if run_dir in (None, "", "none"):
        return None, {}
    run_dir = run_dir.rstrip("/")
    if not re.fullmatch(r"eval/runs/[A-Za-z0-9._-]+", run_dir) or not os.path.isdir(run_dir):
        raise SystemExit(f"stored run {run_dir!r}: not a folder under eval/runs/; nothing built")
    run = json.load(open(os.path.join(run_dir, "run.json"), encoding="utf-8"))
    if "finished_utc" not in run:
        raise SystemExit(f"{run_dir}: the run did not finish (no finished_utc); nothing built")
    if run.get("agent_version") != version or run.get("spec_sha256") != sha:
        raise SystemExit(f"{run_dir}: made by {run.get('agent_version')} (spec {str(run.get('spec_sha256'))[:12]}), but this "
                         f"commit's agent is {version} (spec {sha[:12]}). Point demo/stored_run.txt at a run of this agent.")
    decisions = {}
    for case_id in run["cases"]:
        if case_id not in cases:
            continue  # the smoke case or a fairness pair: not shown in the viewer
        if not cases[case_id]["labeled"]:
            raise SystemExit(f"{run_dir}: holds a decision for {case_id}, which has no final labels yet; nothing built")
        d = json.load(open(os.path.join(run_dir, case_id + ".json"), encoding="utf-8"))
        decisions[case_id] = {k: d.get(k) for k in STORED_FIELDS}
    meta = {"folder": run_dir, "case_set": run.get("case_set"), "budget": run.get("budget"), "started_utc": run.get("started_utc"),
            "finished_utc": run.get("finished_utc"), "workflow_run": run.get("workflow_run"),
            "models_returned": run.get("models_returned"), "git_commit": run.get("git_commit")}
    return meta, decisions


def script_hash(page):
    scripts = re.findall(r"<script>(.*?)</script>", page, flags=re.S)
    assert len(scripts) == 1 and page.count("<script") == 1, "demo/pages/index.html: exactly one plain inline script"
    return "sha256-" + base64.b64encode(hashlib.sha256(scripts[0].encode("utf-8")).digest()).decode()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--stored-run", help="use this run folder instead of demo/stored_run.txt (tests)")
    args = ap.parse_args(argv)
    version, sha = agent_identity()
    held = held_out()
    cases, order = {}, []
    for d in sorted(glob.glob(b.CASE_GLOB)):
        v = b.case_view(d)
        cid = v["case"]
        bundle = json.load(open(os.path.join(d, "bundle.json"), encoding="utf-8"))
        cases[cid] = {"name": cid.replace("case_", "Case "), "view": v, "bundle": bundle,
                      "labeled": os.path.exists(os.path.join(d, "labels.yaml")), "held_out": cid in held}
        order.append(cid)
    if len(order) != 12:
        raise SystemExit(f"expected 12 golden cases, found {len(order)}; nothing built")
    run_dir = args.stored_run if args.stored_run is not None else open("demo/stored_run.txt", encoding="utf-8").read().strip()
    run_meta, decisions = stored(run_dir, cases, version, sha)
    page = open("demo/pages/index.html", encoding="utf-8").read()
    body = {"agent": {"version": version, "spec_sha256": sha}, "held_out": held, "order": order, "cases": cases,
            "stored_run": run_meta, "stored": decisions}
    content_sha = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    content = dict(body, content_sha256=content_sha, page=page, page_script_hash=script_hash(page))
    text = ("// Built by demo/build_demo.py from the repository. Not committed; rebuilt before every test and deploy.\n"
            "export const CONTENT = " + json.dumps(content, ensure_ascii=False, separators=(",", ":")) + ";\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(text)
    live = [c for c in order if cases[c]["labeled"] and not cases[c]["held_out"]]
    print(f"wrote {args.out}: 12 cases; live runs allowed on {', '.join(live) or 'none'}; held out {', '.join(held)}; "
          f"stored decisions: {len(decisions)} ({run_dir}); content {content_sha[:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
