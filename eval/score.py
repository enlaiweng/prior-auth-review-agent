#!/usr/bin/env python3
"""Score one agent run against the final labels, with every metric in docs/EVAL_PLAN.md (Metrics and release thresholds).

Usage (from the repository root): python3 eval/score.py eval/runs/RUN
Reads RUN/<case>.json (decisions from eval/run_agent.mjs) and each case's final labels: data/golden/case_NN/labels.yaml,
or data/smoke/case_00/labels.yaml for the smoke case. A case without final labels is listed as not scored. Blind and
Gemini labels are never used for scoring, and the locked intended answers are never read.
Writes RUN/score.json and RUN/score.md. Exit code 0, whatever the scores; it only measures.

How each metric is counted (EVAL_PLAN.md; choices the plan leaves open are marked "reading"):
- False approvals: decisions of approve on a case whose label is request or route. Hard gate: 0.
- Citation faithfulness: of the criteria with a policy quote, the share whose quote appears word for word in one of
  the policy passages that criterion cites (data/policy/passages.json, made from data/policy/L34220.md), comparing
  with runs of spaces and line breaks treated as one space. Readings: a criterion with no quote is not a cited
  criterion (how many had none is reported beside it); a quote must sit in a passage the criterion cites, so a right
  quote under a wrong passage id counts as mismatched; and a quote of fewer than three words counts only when it is a
  whole passage (some passages are one word, such as "Fever"), so a fragment like "the" cannot pass.
- Evidence validity: of every id cited (criteria and contradictions), the share that exists in the case: a resource
  in the bundle, or a note paragraph note:pN as eval/tools/build_case_pages.py numbers them. Hard gate: 100%.
- Per-criterion agreement: of the four statuses per case, the share equal to the label's.
- Routing agreement: the share of cases whose routing equals the label's.
- Missing-documentation recall: of the cases labeled with a named gap, the share the agent routes to request with a
  gap on the same criterion. Reading: matched on the criterion; the agent's wording is shown beside the label's.
- Abstention calibration: of the cases labeled route, the share the agent routes. Reading: request counts as not
  routing.
- Pend rate: the share of cases not approved. Reported, not gated.
- Reviewer minutes (estimate from output structure, not observed time): 45 seconds per cited record element, the note
  counted once if any part of it is cited, plus two minutes when routed. Baseline: every element in the bundle plus
  the note, at 45 seconds each.
A decision that failed (an API or format error) counts as what the system did with it: route.
"""
import base64, glob, json, os, re, sys

import yaml

KEYS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]
THRESHOLDS = {  # EVAL_PLAN.md, Metrics and release thresholds
    "false_approvals": ("count", 0), "citation_faithfulness": ("min", 0.95), "evidence_validity": ("min", 1.0),
    "per_criterion_agreement": ("min", 0.85), "routing_agreement": ("min", 0.80),
    "missing_documentation_recall": ("min", 0.80), "abstention_calibration": ("min", 0.90),
}


def load(path, kind="json"):
    with open(path, encoding="utf-8") as f:
        return json.load(f) if kind == "json" else yaml.safe_load(f)


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def passage_texts():
    return {p["id"]: norm(p["text"]) for p in load("data/policy/passages.json")["passages"]}


def quote_faithful(quote, cited_passages, passages):
    q = norm(quote)
    texts = [passages[p] for p in cited_passages if p in passages]
    if not any(q in t for t in texts):
        return False
    return len(q.split()) >= 3 or any(q.rstrip(".,;:") == t.rstrip(".,;:") for t in texts)


def case_dir(case_id):
    return "data/smoke/case_00" if case_id == "case_00" else f"data/golden/{case_id}"


def case_ids(cdir):
    """Ids in the case: every resource in the bundle, and the note's paragraphs as build_case_pages.py numbers them."""
    bundle = load(os.path.join(cdir, "bundle.json"))
    res = [e["resource"] for e in bundle["entry"]]
    ids = {f"{r['resourceType']}/{r['id']}" for r in res}
    doc = next(r for r in res if r["resourceType"] == "DocumentReference")
    note = base64.b64decode(doc["content"][0]["attachment"]["data"]).decode()
    paras = [p.strip() for p in re.split(r"\n\s*\n", note.strip()) if p.strip()]
    ids.update(f"note:p{i}" for i in range(1, len(paras) + 1))
    n_elements = len([r for r in res if r["resourceType"] != "DocumentReference"]) + 1
    return ids, f"DocumentReference/{doc['id']}", n_elements


def ratio(num, den):
    return None if den == 0 else num / den


def score(run_dir):
    passages = passage_texts()
    decisions = {}
    for p in sorted(glob.glob(os.path.join(run_dir, "case_*.json"))):
        d = load(p)
        decisions[d["case_id"]] = d
    scored, unscored, rows = [], [], []
    c = dict(fa=0, not_approvable=0, quotes=0, quotes_ok=0, no_quote=0, ids=0, ids_ok=0, crit=0, crit_ok=0,
             route_ok=0, gaps=0, gaps_hit=0, routes=0, routes_ok=0, pended=0, minutes=0.0, baseline=0.0, all_supported_mismatch=0)
    for cid, d in decisions.items():
        lp = os.path.join(case_dir(cid), "labels.yaml")
        if not os.path.exists(lp):
            unscored.append(cid)
            continue
        lab = load(lp, "yaml")
        scored.append(cid)
        ids, note_doc, n_el = case_ids(case_dir(cid))
        crit = d.get("criteria") or {}
        routing = d["routing"]
        expected = lab["expected_routing"]
        row = {"case": cid, "label": expected, "agent": routing, "error": d.get("error")}
        # false approvals
        if expected != "approve":
            c["not_approvable"] += 1
            if routing == "approve":
                c["fa"] += 1
        # citations and evidence
        cited = []
        for k in KEYS:
            x = crit.get(k) or {}
            q = (x.get("policy_quote") or "").strip()
            if q:
                c["quotes"] += 1
                if quote_faithful(q, x.get("policy_passages") or [], passages):
                    c["quotes_ok"] += 1
            elif crit:
                c["no_quote"] += 1
            cited += x.get("evidence") or []
        for con in d.get("contradictions") or []:
            cited += con.get("evidence") or []
        c["ids"] += len(cited)
        c["ids_ok"] += sum(1 for i in cited if i in ids)
        # statuses
        agree = 0
        for k in KEYS:
            c["crit"] += 1
            if (crit.get(k) or {}).get("status") == lab["criteria"][k]["status"]:
                c["crit_ok"] += 1
                agree += 1
        row["statuses_agreeing"] = f"{agree} of 4"
        if crit and all((crit.get(k) or {}).get("status") == "supported" for k in KEYS) and \
                not all(lab["criteria"][k]["status"] == "supported" for k in KEYS):
            c["all_supported_mismatch"] += 1
        # routing, gaps, abstention, pend
        c["route_ok"] += routing == expected
        gap = lab.get("named_gap")
        if gap:
            c["gaps"] += 1
            hit = routing == "request" and (d.get("named_gap") or {}).get("criterion") == gap["criterion"]
            c["gaps_hit"] += hit
            row["gap"] = {"label": gap, "agent": d.get("named_gap"), "matched": bool(hit)}
        if expected == "route":
            c["routes"] += 1
            c["routes_ok"] += routing == "route"
        c["pended"] += routing != "approve"
        # reviewer minutes, estimated from output structure
        record_ids = {i for i in cited if not i.startswith("note:p") and i != note_doc}
        note_cited = any(i.startswith("note:p") or i == note_doc for i in cited)
        mins = 0.75 * (len(record_ids) + (1 if note_cited else 0)) + (2 if routing == "route" else 0)
        c["minutes"] += mins
        c["baseline"] += 0.75 * n_el
        row["reviewer_minutes_estimate"] = mins
        rows.append(row)
    n = len(scored)
    metrics = {
        "false_approvals": c["fa"], "not_approvable_cases": c["not_approvable"],
        "citation_faithfulness": ratio(c["quotes_ok"], c["quotes"]), "criteria_without_quote": c["no_quote"],
        "evidence_validity": ratio(c["ids_ok"], c["ids"]), "ids_cited": c["ids"],
        "per_criterion_agreement": ratio(c["crit_ok"], c["crit"]),
        "routing_agreement": ratio(c["route_ok"], n),
        "missing_documentation_recall": ratio(c["gaps_hit"], c["gaps"]), "labeled_gaps": c["gaps"],
        "abstention_calibration": ratio(c["routes_ok"], c["routes"]), "labeled_routes": c["routes"],
        "pend_rate": ratio(c["pended"], n),
        "reviewer_minutes_per_case_estimate": ratio(c["minutes"], n),
        "baseline_minutes_per_case_estimate": ratio(c["baseline"], n),
        "cases_all_supported_but_label_not": c["all_supported_mismatch"],
    }
    gates = {}
    for m, (kind, t) in THRESHOLDS.items():
        v = metrics[m]
        gates[m] = None if v is None or n == 0 else (v <= t if kind == "count" else v >= t - 1e-12)
    return {"run": run_dir, "scored_cases": scored, "unscored_cases": unscored,
            "errors": [cid for cid, d in decisions.items() if d.get("error")], "metrics": metrics, "meets_threshold": gates,
            "cases": rows}


def markdown(s):
    m, g = s["metrics"], s["meets_threshold"]
    pct = lambda v: "no cases" if v is None else f"{v * 100:.0f}%"
    mark = lambda k: {True: "meets", False: "**below**", None: "n/a"}[g[k]]
    out = [f"# Score: {s['run']}", "",
           f"Scored {len(s['scored_cases'])} case(s) against final labels: {', '.join(s['scored_cases']) or 'none'}."
           + (f" Not scored (no final labels yet): {', '.join(s['unscored_cases'])}." if s["unscored_cases"] else "")
           + (f" Failed decisions, counted as route: {', '.join(s['errors'])}." if s["errors"] else ""), "",
           "| Metric | Result | Threshold | |", "|---|---|---|---|",
           f"| False approvals | {m['false_approvals']} of {m['not_approvable_cases']} | 0 (hard gate) | {mark('false_approvals')} |",
           f"| Citation faithfulness | {pct(m['citation_faithfulness'])} ({m['criteria_without_quote']} criteria without a quote) | 95% | {mark('citation_faithfulness')} |",
           f"| Evidence validity | {pct(m['evidence_validity'])} of {m['ids_cited']} ids | 100% (hard gate) | {mark('evidence_validity')} |",
           f"| Per-criterion agreement | {pct(m['per_criterion_agreement'])} | 85% | {mark('per_criterion_agreement')} |",
           f"| Routing agreement | {pct(m['routing_agreement'])} | 80% | {mark('routing_agreement')} |",
           f"| Missing-documentation recall | {pct(m['missing_documentation_recall'])} of {m['labeled_gaps']} gaps | 80% | {mark('missing_documentation_recall')} |",
           f"| Abstention calibration | {pct(m['abstention_calibration'])} of {m['labeled_routes']} route cases | 90% | {mark('abstention_calibration')} |",
           f"| Pend rate | {pct(m['pend_rate'])} | reported | |",
           "| Reviewer minutes per case (estimate) | " + ("n/a" if m["reviewer_minutes_per_case_estimate"] is None else
              f"{m['reviewer_minutes_per_case_estimate']:.1f}, against {m['baseline_minutes_per_case_estimate']:.1f} opening everything") + " | reported | |",
           "", "| Case | Label | Agent | Statuses agreeing | Gap (label / agent) |", "|---|---|---|---|---|"]
    for r in s["cases"]:
        gap = ""
        if "gap" in r:
            a = r["gap"]["agent"]
            gap = f"{r['gap']['label']['criterion']}: {r['gap']['label']['missing']} / " + (f"{a['criterion']}: {a['missing']}" if a else "none")
        out.append(f"| {r['case']} | {r['label']} | {r['agent']}{' (error)' if r['error'] else ''} | {r['statuses_agreeing']} | {gap} |")
    out += ["", "With few cases these percentages are coarse; see EVAL_PLAN.md. Reviewer minutes are an estimate from the output's structure, not observed time."]
    return "\n".join(out) + "\n"


def main(argv):
    if len(argv) != 1:
        print(__doc__.split("\n\n")[1])
        return 1
    s = score(argv[0])
    with open(os.path.join(argv[0], "score.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(s, indent=1) + "\n")
    md = markdown(s)
    with open(os.path.join(argv[0], "score.md"), "w", encoding="utf-8") as f:
        f.write(md)
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
