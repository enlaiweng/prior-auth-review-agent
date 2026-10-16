#!/usr/bin/env python3
"""Tests for the third reader's script and the label checker, with a fake Gemini server on this computer.

Run from the repository root: python3 -m unittest discover -s eval/tests -p "test_*.py"
Nothing is sent to Google. The script runs in a temporary copy of the repository, so no file here changes.
The labels in the fake replies are arbitrary test values chosen to exercise the code; they say nothing about any case.
"""
import http.server, json, os, shutil, sys, tempfile, threading, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "eval", "tools"))
sys.path.insert(0, os.path.join(ROOT, "eval", "third_reader"))


def arbitrary_reply(case_id, case_dir, cite):
    """A reply in the prompt's YAML shape. Every status is undeterminable and the routing is route, as plain test values."""
    lines = [f"case_id: {case_id}", "criteria:"]
    for k in ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"]:
        lines.append(f"  {k}: {{status: undeterminable, evidence: [{cite}]}}")
    lines += ["expected_routing: route", "named_gap: null"]
    return "\n".join(lines) + "\n"


class FakeGemini(http.server.BaseHTTPRequestHandler):
    replies = {}      # case_id -> list of (status, body) served in order
    seen = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = body["contents"][0]["parts"][0]["text"]
        FakeGemini.seen.append({"path": self.path, "key": self.headers.get("x-goog-api-key"), "body": body})
        case_id = next(c for c in FakeGemini.replies if f"case_id: {c}" in prompt)
        status, payload = FakeGemini.replies[case_id].pop(0)
        out = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def ok_payload(text):
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": "thinking", "thought": True}, {"text": text}]},
                            "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50},
            "modelVersion": "gemini-3.8-flash-test-0001", "responseId": "r1"}


class ThirdReaderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        for d in ["data", "docs", "eval"]:
            shutil.copytree(os.path.join(ROOT, d), os.path.join(cls.tmp, d), ignore=shutil.ignore_patterns("node_modules"))
        cls.old = os.getcwd()
        os.chdir(cls.tmp)
        import check_labels
        cls.ids = {c: sorted(check_labels.citable_ids(f"data/golden/{c}")) for c in ["case_01", "case_02", "case_03"]}
        claim = lambda c: next(i for i in cls.ids[c] if i.startswith("Claim/"))
        FakeGemini.replies = {
            # case_01: a rate limit first, then a plain YAML reply
            "case_01": [(429, {"error": {"code": 429, "message": "quota", "details": [{"retryDelay": "0s"}]}}),
                        (200, ok_payload(arbitrary_reply("case_01", "", claim("case_01"))))],
            # case_02: the YAML wrapped in a ``` fence
            "case_02": [(200, ok_payload("```yaml\n" + arbitrary_reply("case_02", "", claim("case_02")) + "```\n"))],
            # case_03: an evidence id that is not in the case
            "case_03": [(200, ok_payload(arbitrary_reply("case_03", "", "Procedure/not-in-this-case")))],
        }
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), FakeGemini)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        os.environ["GEMINI_API_KEY"] = "test-key-not-real"
        os.environ.pop("GITHUB_RUN_ID", None)
        import run_third_reader
        cls.code = run_third_reader.main(["--cases", "01,02,03", "--pause", "0", "--summary", "summary.md",
                                          "--test-base-url", f"http://127.0.0.1:{cls.server.server_port}/{{model}}"])
        with open("eval/third_reader/runs/local/run_record.json") as f:
            cls.record = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        os.chdir(cls.old)
        shutil.rmtree(cls.tmp)

    def test_exit_code_reports_the_failed_case(self):
        self.assertEqual(self.code, 3)

    def test_key_sent_in_header_not_url(self):
        for s in FakeGemini.seen:
            self.assertEqual(s["key"], "test-key-not-real")
            self.assertNotIn("test-key-not-real", s["path"])
            self.assertEqual(list(s["body"]), ["contents"])  # no other settings sent

    def test_retry_after_rate_limit(self):
        self.assertEqual(self.record["cases"]["case_01"]["attempts"], 2)
        self.assertEqual(self.record["cases"]["case_01"]["outcome"], "labeled")

    def test_model_version_recorded(self):
        self.assertEqual(self.record["model_versions_returned"], ["gemini-3.8-flash-test-0001"])
        self.assertTrue(os.path.exists("eval/third_reader/runs/local/case_01.response.json"))

    def test_labels_file_passes_the_checker(self):
        import check_labels
        for c in ["case_01", "case_02"]:
            self.assertEqual(check_labels.check_file(f"data/golden/{c}/labels_gemini.yaml"), [], c)
        with open("data/golden/case_01/labels_gemini.yaml") as f:
            text = f.read()
        self.assertIn("Model version Gemini reported: gemini-3.8-flash-test-0001", text)
        self.assertIn("named_gap: null", text)

    def test_fence_removed_and_recorded(self):
        self.assertEqual(self.record["cases"]["case_02"]["parse_note"], "a ``` fence around the YAML was removed")

    def test_bad_evidence_not_written(self):
        e = self.record["cases"]["case_03"]
        self.assertEqual(e["outcome"], "failed")
        self.assertTrue(any("not-in-this-case" in p for p in e["problems"]))
        self.assertFalse(os.path.exists("data/golden/case_03/labels_gemini.yaml"))

    def test_summary_written(self):
        with open("summary.md") as f:
            s = f.read()
        self.assertIn("| case_03 | failed |", s)

    def test_verify_passes_then_catches_an_edit(self):
        import run_third_reader
        self.assertEqual(run_third_reader.verify(), [])
        path = "data/golden/case_02/labels_gemini.yaml"
        original = open(path).read()
        try:
            with open(path, "w") as f:
                f.write(original.replace("expected_routing: route", "expected_routing: request"))
            found = run_third_reader.verify()
            self.assertEqual(len(found), 1)
            self.assertIn("differs from what the script writes", found[0])
        finally:
            with open(path, "w") as f:
                f.write(original)
        self.assertEqual(run_third_reader.main(["--verify"]), 0)

    def test_record_fingerprints_the_labels_file(self):
        import hashlib
        e = self.record["cases"]["case_01"]
        with open("data/golden/case_01/labels_gemini.yaml", "rb") as f:
            self.assertEqual(e["labels_sha256"], hashlib.sha256(f.read()).hexdigest())

    def test_existing_labels_never_overwritten(self):
        import run_third_reader
        before = open("data/golden/case_01/labels_gemini.yaml").read()
        n = len(FakeGemini.seen)
        os.environ["GITHUB_RUN_ID"] = "second"
        try:
            code = run_third_reader.main(["--cases", "01", "--pause", "0", "--test-base-url", "http://127.0.0.1:1/{model}"])
        finally:
            os.environ.pop("GITHUB_RUN_ID", None)
        self.assertEqual(code, 0)
        self.assertEqual(len(FakeGemini.seen), n)  # nothing sent
        self.assertEqual(open("data/golden/case_01/labels_gemini.yaml").read(), before)
        with open("eval/third_reader/runs/second/run_record.json") as f:
            self.assertEqual(json.load(f)["cases"]["case_01"]["outcome"], "skipped")


class CheckLabelsTest(unittest.TestCase):
    def setUp(self):
        import check_labels
        self.cl = check_labels
        self.case = os.path.join(ROOT, "data", "golden", "case_01")
        self.claim = next(i for i in check_labels.citable_ids(self.case) if i.startswith("Claim/"))

    def base(self):
        crit = {k: {"status": "undeterminable", "evidence": []} for k in self.cl.CRITERIA}
        return {"case_id": "case_01", "labeled_on": "2026-10-20", "criteria": crit, "expected_routing": "route", "named_gap": None}

    def test_complete_file_passes(self):
        self.assertEqual(self.cl.problems(self.base(), self.case, "labels_blind.yaml"), [])

    def test_blank_status_fails(self):
        d = self.base(); d["criteria"]["C3_informs_management"]["status"] = None
        self.assertTrue(any("C3_informs_management status" in p for p in self.cl.problems(d, self.case, "labels_blind.yaml")))

    def test_request_needs_gap(self):
        d = self.base(); d["expected_routing"] = "request"
        self.assertTrue(any("named_gap" in p for p in self.cl.problems(d, self.case, "labels_blind.yaml")))
        d["named_gap"] = {"criterion": "C4", "missing": "a test value"}
        self.assertEqual(self.cl.problems(d, self.case, "labels_blind.yaml"), [])

    def test_gap_without_request_fails(self):
        d = self.base(); d["named_gap"] = {"criterion": "C4", "missing": "x"}
        self.assertTrue(self.cl.problems(d, self.case, "labels_blind.yaml"))

    def test_unknown_id_fails_known_id_passes(self):
        d = self.base(); d["criteria"]["C1_red_flag"]["evidence"] = ["Observation/nope"]
        self.assertTrue(self.cl.problems(d, self.case, "labels_blind.yaml"))
        d["criteria"]["C1_red_flag"]["evidence"] = [self.claim, "note:p1"]
        self.assertEqual(self.cl.problems(d, self.case, "labels_blind.yaml"), [])

    def test_wrong_case_id_fails(self):
        d = self.base(); d["case_id"] = "case_02"
        self.assertTrue(self.cl.problems(d, self.case, "labels_blind.yaml"))


if __name__ == "__main__":
    unittest.main()
