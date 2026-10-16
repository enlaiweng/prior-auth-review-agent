#!/usr/bin/env python3
"""The third reader: send each golden case's fixed prompt to Gemini and save its labels (EVAL_PLAN.md, How the answer key is made).

Run by the "Third reader (Gemini)" workflow, after the owner's blind labels are merged and after he approves the run.
It needs the key in the environment variable GEMINI_API_KEY and never prints it.

Usage (from the repository root):
  python3 eval/third_reader/run_third_reader.py [--cases all | 01,05,15] [--summary FILE]

For each case it:
  1. checks the prompt against its fingerprint in eval/third_reader/prompts/prompts.sha256 (it stops if any differ);
  2. sends the prompt, exactly as written, to the pinned model with no other settings (the model's own defaults);
  3. saves Gemini's whole reply in eval/third_reader/runs/RUN/case_NN.response.json (RUN is the workflow run's number),
     including the model version Gemini reports for itself;
  4. reads the YAML in the reply and checks its form with eval/tools/check_labels.py;
  5. if it passes, writes data/golden/case_NN/labels_gemini.yaml in the labels template's format. If it does not pass,
     no labels file is written for that case, and the problem is listed in the run record and the pull request.
It also writes eval/third_reader/runs/RUN/run_record.json: the model asked for, the version returned, the prompt and
reply fingerprints, token counts, and the outcome of each case. A case that already has labels_gemini.yaml is not sent
again: those labels are never edited, and every run's replies stay in their own folder.
Exit code: 0 when every case passed, 3 when some did not (the files for the cases that passed are still written), 1 on a
setup problem such as a missing key or a changed prompt.

  python3 eval/third_reader/run_third_reader.py --verify
checks, with no key and no network, that every labels_gemini.yaml is exactly what this script writes from the reply
saved in its run folder, and that the reply is the one the run record fingerprinted. The Checks workflow runs it on
every pull request, so a Gemini label file cannot be edited by hand without the check failing.
"""
import argparse, datetime, glob, hashlib, json, os, re, sys, time, urllib.error, urllib.request

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
from check_labels import CRITERIA, problems  # noqa: E402  (same checks the owner's labels get)

# Pinned for this project (GOVERNANCE.md, decision log, 2026-10-16). Changing it needs a pull request.
MODEL = "gemini-3.8-flash"
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PROMPTS = "eval/third_reader/prompts"
RUNS = "eval/third_reader/runs"
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 5


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_prompts():
    """Read every prompt and check it against prompts.sha256. Returns {case_id: (text, sha)}; stops on any mismatch."""
    expected = {}
    for line in open(os.path.join(PROMPTS, "prompts.sha256"), encoding="utf-8"):
        if line.strip():
            digest, name = line.split()
            expected[name.replace(".txt", "")] = digest
    found = {os.path.basename(p)[:-4] for p in glob.glob(os.path.join(PROMPTS, "case_*.txt"))}
    if found != set(expected):
        sys.exit(f"setup problem: prompts on disk {sorted(found)} do not match prompts.sha256 {sorted(expected)}")
    out = {}
    for case_id, digest in sorted(expected.items()):
        text = open(os.path.join(PROMPTS, case_id + ".txt"), encoding="utf-8").read()
        if sha256(text) != digest:
            sys.exit(f"setup problem: {case_id}.txt does not match its fingerprint; the prompts changed after they were fixed")
        out[case_id] = (text, digest)
    return out


def retry_wait(attempt, body):
    """Seconds to wait before the next attempt: Gemini's own retryDelay when it gives one, otherwise 10, 20, 40, 80 s."""
    try:
        for d in json.loads(body).get("error", {}).get("details", []):
            if str(d.get("retryDelay", "")).endswith("s"):
                return min(float(d["retryDelay"][:-1]) + 1, 120)
    except (ValueError, AttributeError):
        pass
    return min(10 * 2 ** (attempt - 1), 120)


def call_gemini(prompt, key, model, base):
    """Send one prompt. Returns (http_status, parsed_json_or_text, attempts). Retries only on rate limits and server errors."""
    url = (base or API).format(model=model)
    body = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}]}).encode("utf-8")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.status, json.loads(r.read().decode("utf-8")), attempt
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if e.code in RETRY_STATUSES and attempt < MAX_ATTEMPTS:
                wait = retry_wait(attempt, text)
                print(f"  HTTP {e.code}; waiting {wait:.0f} s before trying again (attempt {attempt} of {MAX_ATTEMPTS})")
                time.sleep(wait)
                continue
            try:
                return e.code, json.loads(text), attempt
            except ValueError:
                return e.code, text, attempt
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < MAX_ATTEMPTS:
                print(f"  connection problem ({e}); trying again")
                time.sleep(retry_wait(attempt, ""))
                continue
            return 0, str(e), attempt
    return 0, "no attempts made", MAX_ATTEMPTS


def reply_text(resp):
    """The answer text from a generateContent reply: the first candidate's parts, leaving out any thought parts."""
    cands = resp.get("candidates") or []
    if not cands:
        return None
    parts = (cands[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


FENCE = re.compile(r"```(?:ya?ml)?\s*\n(.*?)```", re.S | re.I)


def parse_reply(text):
    """Read the YAML in a reply. The prompt asks for YAML only; if Gemini wraps it in a ``` fence anyway, the fence is
    removed and nothing else. Returns (data, note) where note says what was done, or raises ValueError."""
    if text is None or not text.strip():
        raise ValueError("the reply has no text")
    note = "reply used as written"
    m = FENCE.search(text)
    if m:
        text, note = m.group(1), "a ``` fence around the YAML was removed"
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ValueError(f"the reply is not valid YAML: {e}")
    if not isinstance(data, dict):
        raise ValueError("the reply is not a set of keys and values")
    return data, note


def labels_yaml(data, case_id, labeled_on, model_requested, model_version, prompt_sha, response_file):
    """The labels in the labels template's format (data/golden/_template/labels_blind.yaml), with the reader recorded."""
    lines = [
        "# Third reader's labels for one case: Gemini through its API (EVAL_PLAN.md, How the answer key is made). Never edited after commit.",
        f"# Written by eval/third_reader/run_third_reader.py from the reply saved in {response_file}.",
        f"# Model requested: {model_requested}. Model version Gemini reported: {model_version}. Prompt sha256: {prompt_sha}.",
        f"case_id: {case_id}",
        f"labeled_on: {labeled_on}",
        "criteria:",
    ]
    for k in CRITERIA:
        c = data["criteria"][k]
        lines.append("  " + (k + ":").ljust(25) + "{status: " + c["status"] + ", evidence: [" + ", ".join(c["evidence"]) + "]}")
    lines.append("expected_routing: " + data["expected_routing"])
    gap = data.get("named_gap")
    if gap:
        lines.append("named_gap: {criterion: " + gap["criterion"] + ", missing: " + json.dumps(str(gap["missing"]).strip()) + "}")
    else:
        lines.append("named_gap: null")
    return "\n".join(lines) + "\n"


HEADER = re.compile(r"^# Written by eval/third_reader/run_third_reader.py from the reply saved in (\S+)\.\n"
                    r"# Model requested: (\S+)\. Model version Gemini reported: (.+)\. Prompt sha256: ([0-9a-f]{64})\.$", re.M)


def verify():
    """Rebuild every labels_gemini.yaml from its saved reply and compare. Returns a list of problems (empty when all match)."""
    out = []
    sums = {}
    for line in open(os.path.join(PROMPTS, "prompts.sha256"), encoding="utf-8"):
        if line.strip():
            digest, name = line.split()
            sums[name.replace(".txt", "")] = digest
    for path in sorted(glob.glob("data/golden/case_*/labels_gemini.yaml")):
        case_id = path.split("/")[2]
        text = open(path, encoding="utf-8").read()
        m = HEADER.search(text)
        if not m:
            out.append(f"{path}: the header naming its reply, model, and prompt is missing or changed")
            continue
        response_file, model_requested, model_version, prompt_sha = m.groups()
        if prompt_sha != sums.get(case_id):
            out.append(f"{path}: its prompt fingerprint does not match prompts.sha256")
        if not os.path.exists(response_file):
            out.append(f"{path}: the reply it names, {response_file}, is not in the repository")
            continue
        raw = open(response_file, encoding="utf-8").read()
        record_path = os.path.join(os.path.dirname(response_file), "run_record.json")
        try:
            entry = json.load(open(record_path, encoding="utf-8"))["cases"][case_id]
            if entry.get("response_sha256") != sha256(raw):
                out.append(f"{path}: the saved reply does not match the fingerprint in {record_path}")
            if entry.get("labels_sha256") != sha256(text):
                out.append(f"{path}: does not match the labels fingerprint in {record_path}")
        except (OSError, KeyError, ValueError):
            out.append(f"{path}: no entry for {case_id} in {record_path}")
        resp = json.loads(raw)
        try:
            data, _ = parse_reply(reply_text(resp))
        except ValueError as e:
            out.append(f"{path}: its saved reply cannot be read ({e})")
            continue
        labeled_on = (yaml.safe_load(text) or {}).get("labeled_on")
        rebuilt = labels_yaml(data, case_id, labeled_on, model_requested, resp.get("modelVersion"), prompt_sha, response_file)
        if rebuilt != text:
            out.append(f"{path}: differs from what the script writes from its saved reply")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cases", default="all", help="all, or case numbers separated by commas, for example 01,05")
    ap.add_argument("--summary", help="also write a short markdown summary to this file (for the pull request)")
    ap.add_argument("--pause", type=float, default=5.0, help="seconds to wait between cases (free-tier rate limits)")
    ap.add_argument("--verify", action="store_true", help="check every labels_gemini.yaml against its saved reply, then stop")
    ap.add_argument("--test-base-url", help=argparse.SUPPRESS)  # tests only: a local fake server
    args = ap.parse_args(argv)
    if args.verify:
        found = verify()
        for f in found:
            print("FAIL " + f)
        n = len(glob.glob("data/golden/case_*/labels_gemini.yaml"))
        print(f"{n} Gemini label file(s) checked against their saved replies: " + ("all match" if not found else f"{len(found)} problem(s)"))
        return 1 if found else 0

    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("setup problem: GEMINI_API_KEY is not set")
        return 1
    prompts = load_prompts()
    if args.cases == "all":
        wanted = list(prompts)
    else:
        wanted = ["case_" + c.strip().zfill(2) for c in args.cases.split(",") if c.strip()]
        unknown = [c for c in wanted if c not in prompts]
        if unknown:
            print("setup problem: no prompt for " + ", ".join(unknown))
            return 1

    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    run_dir = f"{RUNS}/{run_id}"
    os.makedirs(run_dir, exist_ok=True)
    today = datetime.date.today().isoformat()
    record = {
        "reader": "Gemini, through the Gemini API (generateContent)",
        "model_requested": MODEL,
        "request_settings": "the prompt as the only content; no generationConfig, so the model's default temperature and thinking level",
        "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "workflow_run": os.environ.get("RUN_URL", ""),
        "run_id": run_id,
        "cases": {},
    }
    sent = 0
    for case_id in wanted:
        text, prompt_sha = prompts[case_id]
        existing = os.path.join("data/golden", case_id, "labels_gemini.yaml")
        if os.path.exists(existing):
            record["cases"][case_id] = {"prompt_sha256": prompt_sha, "outcome": "skipped",
                                        "problems": ["already labeled in an earlier run; not sent again"]}
            print(f"{case_id}: skipped, {existing} already exists")
            continue
        if sent:
            time.sleep(args.pause)
        sent += 1
        print(f"{case_id}: sending the prompt ({len(text)} characters, sha256 {prompt_sha[:12]})")
        status, resp, attempts = call_gemini(text, key, MODEL, args.test_base_url)
        entry = {"prompt_sha256": prompt_sha, "http_status": status, "attempts": attempts}
        response_file = f"{run_dir}/{case_id}.response.json"
        if isinstance(resp, dict):
            raw = json.dumps(resp, indent=1, ensure_ascii=False) + "\n"
            entry["response_sha256"] = sha256(raw)
            open(response_file, "w", encoding="utf-8").write(raw)
            entry["response_file"] = response_file
            entry["model_version"] = resp.get("modelVersion")
            entry["response_id"] = resp.get("responseId")
            entry["usage"] = resp.get("usageMetadata")
            cands = resp.get("candidates") or [{}]
            entry["finish_reason"] = cands[0].get("finishReason")
        if status != 200 or not isinstance(resp, dict):
            msg = resp.get("error", {}).get("message") if isinstance(resp, dict) else str(resp)[:300]
            entry.update(outcome="failed", problems=[f"the API returned HTTP {status}: {msg}"])
        else:
            try:
                data, note = parse_reply(reply_text(resp))
                entry["parse_note"] = note
                data_checked = dict(data, labeled_on=today)
                found = problems(data_checked, os.path.join("data/golden", case_id), "labels_gemini.yaml")
                if entry.get("finish_reason") not in (None, "STOP"):
                    found.append(f"the reply stopped early (finishReason {entry['finish_reason']})")
            except ValueError as e:
                found = [str(e)]
            if found:
                entry.update(outcome="failed", problems=found)
            else:
                out = os.path.join("data/golden", case_id, "labels_gemini.yaml")
                written = labels_yaml(data, case_id, today, MODEL, entry.get("model_version"), prompt_sha, response_file)
                open(out, "w", encoding="utf-8").write(written)
                entry.update(outcome="labeled", labels_file=out, labels_sha256=sha256(written))
        record["cases"][case_id] = entry
        print(f"{case_id}: {entry['outcome']}" + ("" if entry["outcome"] == "labeled" else ": " + "; ".join(entry["problems"])))

    record["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    versions = sorted({str(e.get("model_version")) for e in record["cases"].values() if e["outcome"] != "skipped"})
    record["model_versions_returned"] = versions
    open(f"{run_dir}/run_record.json", "w", encoding="utf-8").write(json.dumps(record, indent=1, ensure_ascii=False) + "\n")

    failed = [c for c, e in record["cases"].items() if e["outcome"] == "failed"]
    if args.summary:
        rows = ["| Case | Outcome | Model version | Tokens in / out | Reply sha256 | Labels sha256 | Note |",
                "|---|---|---|---|---|---|---|"]
        for c, e in record["cases"].items():
            u = e.get("usage") or {}
            tok = f"{u.get('promptTokenCount', '')} / {u.get('candidatesTokenCount', '')}"
            note = e.get("parse_note", "") if e["outcome"] == "labeled" else "; ".join(e["problems"])
            rows.append(f"| {c} | {e['outcome']} | {e.get('model_version')} | {tok} | {e.get('response_sha256', '')} | "
                        f"{e.get('labels_sha256', '')} | {note} |")
        open(args.summary, "w", encoding="utf-8").write(
            f"Model requested: `{MODEL}`. Version Gemini reported: {', '.join(versions)}.\n\n" + "\n".join(rows) + "\n\n"
            "The fingerprints are also in this run's summary on the Actions page, which a later commit can't change; "
            "`run_third_reader.py --verify` checks the files in the pull request against them.\n")
    labeled = [c for c, e in record["cases"].items() if e["outcome"] == "labeled"]
    print(f"done: {len(labeled)} labeled, {len(failed)} not labeled" + (f" ({', '.join(failed)})" if failed else ""))
    return 3 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
