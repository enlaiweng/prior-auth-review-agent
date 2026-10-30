"""Tests for the smoke test record checker (demo/tools/check_smoke_records.py).
Run from the repository root: python3 -m unittest demo/test/test_smoke_records.py

Most tests build a scratch repository from frozen fixtures (a changelog, the held-out list, and final labels for two
cases, written below as they stood when the first record was made), copy the real first record and its saved page
into it, change one thing, and confirm the checker accepts it (positive tests) or names the problem (negative tests).
Because the fixtures are frozen, re-settling a case or a new changelog row never breaks these tests. The real records
are also checked as they are, against their own saved pages.
"""
import os, re, shutil, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "demo", "tools"))
import check_smoke_records as csr  # noqa: E402

RECORD = "2026-10-29-demo-case01.md"
PAGE = "2026-10-29-demo-case01-page.txt"

CHANGELOG = """# Changelog

| Date | Agent version | Change | Reason | Runs |
| --- | --- | --- | --- | --- |
| 2026-10-16 | agent-0.1 | Initial agent; spec fingerprint 26e8981e5d35 | Baseline | Smoke case only |
| 2026-10-19 | agent-0.2 | Approval checked before the red-flag step; spec fingerprint is now 0c7ef2abfd94 | Owner's decision | None yet |
"""
RUNNER = 'export const HELD_OUT = ["case_08", "case_10", "case_12"];\n'


def labels(case_id, c1, c2, c3, c4, routing):
    return (f"case_id: {case_id}\nsettled_on: 2026-10-26\ncriteria:\n"
            f"  C1_red_flag:             {{status: {c1}, evidence: []}}\n"
            f"  C2_conservative_4wk:     {{status: {c2}, evidence: []}}\n"
            f"  C3_informs_management:   {{status: {c3}, evidence: []}}\n"
            f"  C4_no_duplicate_imaging: {{status: {c4}, evidence: []}}\n"
            f"expected_routing: {routing}\nnamed_gap: null\nchanges_from_blind: []\n")


LABELS = {
    "case_01": labels("case_01", "unsupported", "supported", "supported", "supported", "approve"),
    "case_02": labels("case_02", "unsupported", "unsupported", "unsupported", "supported", "route"),
}
NO_LABELS = ["case_05", "case_08", "case_10", "case_12"]


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class Scratch:
    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="smoke-records-")
        write(os.path.join(self.root, "docs/CHANGELOG.md"), CHANGELOG)
        write(os.path.join(self.root, "eval/run_agent.mjs"), RUNNER)
        for case, text in LABELS.items():
            write(os.path.join(self.root, "data/golden", case, "labels.yaml"), text)
        for case in NO_LABELS:
            os.makedirs(os.path.join(self.root, "data/golden", case))
        self.folder = os.path.join(self.root, csr.FOLDER)
        os.makedirs(self.folder)
        self.record = csr.read(os.path.join(ROOT, csr.FOLDER, RECORD))
        self.page = csr.read(os.path.join(ROOT, csr.FOLDER, PAGE))

    def put(self, record=None, page=None, name=RECORD, page_name=PAGE):
        for f in os.listdir(self.folder):
            os.remove(os.path.join(self.folder, f))
        write(os.path.join(self.folder, name), self.record if record is None else record)
        write(os.path.join(self.folder, page_name), self.page if page is None else page)
        return os.path.join(self.folder, name)

    def check(self, record=None, page=None, new=True, **kw):
        return csr.problems(self.root, self.put(record, page, **kw), new)

    def close(self):
        shutil.rmtree(self.root)


def swap(text, old, new):
    assert old in text, f"test setup: {old!r} not found"
    return text.replace(old, new, 1)


class RealRecords(unittest.TestCase):
    def test_every_record_in_the_repository_agrees_with_its_saved_page(self):
        recs = csr.records(ROOT)
        self.assertIn(os.path.join(ROOT, csr.FOLDER, RECORD), recs)
        for r in recs:
            with self.subTest(os.path.basename(r)):
                self.assertEqual(csr.problems(ROOT, r), [])
        self.assertEqual(csr.orphan_pages(ROOT), [])

    def test_the_first_record_against_the_fixtures_it_was_made_with(self):
        s = Scratch()
        try:
            self.assertEqual(s.check(), [])
        finally:
            s.close()

    def test_the_readme_is_not_read_as_a_record(self):
        self.assertNotIn(os.path.join(ROOT, csr.FOLDER, "README.md"), csr.records(ROOT))

    def test_the_viewer_still_uses_the_words_the_checker_expects(self):
        html = csr.read(os.path.join(ROOT, "demo/pages/index.html"))
        for word in list(csr.OUTCOME_WORDS.values()) + list(csr.STATUS_WORDS.values()) + [csr.LIVE_HEADING]:
            self.assertIn(f'"{word}"', html, "the viewer's wording changed; update check_smoke_records.py")
        self.assertIn(f">{csr.RECORD_HEADING}<", html, "the viewer's record heading changed; update check_smoke_records.py")

    def test_the_fixtures_held_out_list_is_the_real_one(self):
        self.assertEqual(csr.held_out(ROOT), {"case_08", "case_10", "case_12"})


class Positive(unittest.TestCase):
    def setUp(self):
        self.s = Scratch()

    def tearDown(self):
        self.s.close()

    def test_optional_fields_can_be_left_out(self):
        rec = re.sub(r"(?m)^(time|notes): .*\n", "", self.s.record)
        self.assertEqual(self.s.check(rec), [])

    def test_a_failed_test_written_honestly_as_fail(self):
        rec = swap(self.s.record, "C3_informs_management: supported", "C3_informs_management: undeterminable")
        rec = swap(rec, "outcome: pass", "outcome: fail")
        page = swap(self.s.page, "C3. Will change the treatment plan\nMet", "C3. Will change the treatment plan\nCan't tell from the record")
        self.assertEqual(self.s.check(rec, page), [])

    def test_approvals_on_with_the_final_labels_routing(self):
        rec = swap(self.s.record, "mode: checklist", "mode: approvals_on")
        rec = swap(rec, "routing: route", "routing: approve")
        page = swap(self.s.page, "Live run, just now\nSend to physician review", "Live run, just now\nApprove")
        page = swap(page, "Checklist mode is on", "Approvals are on")
        self.assertEqual(self.s.check(rec, page), [])

    def test_a_record_for_another_development_case(self):
        rec = swap(self.s.record, "case: case_01", "case: case_02")
        rec = swap(rec, "C2_conservative_4wk: supported", "C2_conservative_4wk: unsupported")
        rec = swap(rec, "C3_informs_management: supported", "C3_informs_management: unsupported")
        page = self.s.page.replace("Claim/case01-claim", "Claim/case02-claim")
        page = swap(page, "C2. Four weeks of conservative care\nMet", "C2. Four weeks of conservative care\nNot met")
        page = swap(page, "C3. Will change the treatment plan\nMet", "C3. Will change the treatment plan\nNot met")
        self.assertEqual(self.s.check(rec, page), [])

    def test_a_merged_record_stays_valid_when_the_case_is_re_settled_later(self):
        # The stuck-record problem: a merged record can't be edited, so later changes must not break it.
        path = self.s.put()
        write(os.path.join(self.s.root, "data/golden/case_01/labels.yaml"),
              LABELS["case_01"].replace("C3_informs_management:   {status: supported", "C3_informs_management:   {status: undeterminable"))
        self.assertEqual(csr.problems(self.s.root, path, new=False), [])
        self.assertNotEqual(csr.problems(self.s.root, path, new=True), [])   # but a new record would be checked

    def test_a_merged_record_stays_valid_when_the_changelog_is_rewritten(self):
        path = self.s.put()
        write(os.path.join(self.s.root, "docs/CHANGELOG.md"), "# Changelog\n")
        self.assertEqual(csr.problems(self.s.root, path, new=False), [])


class Negative(unittest.TestCase):
    """Each change must be caught, with a message that names it, and never with a crash."""

    def setUp(self):
        self.s = Scratch()

    def tearDown(self):
        self.s.close()

    def caught(self, expect, record=None, page=None, new=True, **kw):
        found = self.s.check(record, page, new, **kw)
        self.assertTrue(any(expect in p for p in found), f"expected {expect!r} in {found}")

    def test_record_form(self):
        r = self.s.record
        cases = {
            "no header": (r.split("---\n", 2)[2], "no YAML header"),
            "header not YAML": (swap(r, "mode: checklist", "mode: [checklist"), "no YAML header"),
            "missing field": (re.sub(r"(?m)^model: .*\n", "", r), "missing fields: model"),
            "unknown field": (swap(r, "outcome: pass", "outcome: pass\nscore: 100"), "unexpected fields: score"),
            "date not a date": (swap(r, "date: 2026-10-29", "date: Oct 29"), "date must be written YYYY-MM-DD"),
            "date with a time": (swap(r, "date: 2026-10-29", "date: 2026-10-29 18:00:00"), "date must be written YYYY-MM-DD"),
            "date in the future": (swap(r, "date: 2026-10-29", "date: 2099-01-01"), "the date is in the future"),
            "one-word name": (swap(r, "run_by: Enlai Weng", "run_by: Enlai"), "run_by needs the full name"),
            "empty deploy": (swap(r, "deploy: first deployment of the demo, from main after pull request #17", "deploy: ''"), "deploy must say"),
            "unknown mode": (swap(r, "mode: checklist", "mode: test"), "mode must be"),
            "mode as a list": (swap(r, "mode: checklist", "mode: [checklist]"), "mode must be"),
            "bad version": (swap(r, "agent_version: agent-0.2", "agent_version: 0.2"), "agent_version must look like"),
            "full fingerprint": (swap(r, "spec: 0c7ef2abfd94", "spec: 0c7ef2abfd948bf6fc76"), "spec must be the first 12"),
            "case misspelled": (swap(r, "case: case_01", "case: case 1"), "case must look like"),
            "run time zero": (swap(r, "run_seconds: 38", "run_seconds: 0"), "run_seconds must be"),
            "run time over the limit": (swap(r, "run_seconds: 38", "run_seconds: 300"), "run_seconds must be"),
            "run time as text": (swap(r, "run_seconds: 38", "run_seconds: 38 s"), "run_seconds must be"),
            "run time as yes": (swap(r, "run_seconds: 38", "run_seconds: yes"), "run_seconds must be"),
            "unknown routing": (swap(r, "routing: route", "routing: deny"), "routing must be"),
            "routing as a list": (swap(r, "routing: route", "routing: [route]"), "routing must be"),
            "a criterion missing": (re.sub(r"(?m)^  C4_no_duplicate_imaging: .*\n", "", r), "criteria must list exactly"),
            "an unknown status": (swap(r, "C1_red_flag: unsupported", "C1_red_flag: no"), "each criterion must be"),
            "citations as text": (swap(r, "citations_render: yes", "citations_render: mostly"), "citations_render must be"),
            "unknown outcome": (swap(r, "outcome: pass", "outcome: ok"), "outcome must be"),
            "page file missing": (swap(r, "page_text: 2026-10-29-demo-case01-page.txt", "page_text: other.txt"), "page_text must name a file"),
            "page file outside the folder": (swap(r, "page_text: 2026-10-29-demo-case01-page.txt", "page_text: ../2026-10-29-demo-case01-page.txt"), "page_text must name a file"),
            "approve in checklist mode": (swap(r, "routing: route", "routing: approve"), "in checklist mode every case routes"),
        }
        for name, (record, expect) in cases.items():
            for new in (True, False):   # the record's own form is checked every time
                with self.subTest(name, new=new):
                    self.caught(expect, record, new=new)

    def test_against_the_repository_when_new(self):
        r = self.s.record
        cases = {
            "version not in the changelog": (swap(r, "agent_version: agent-0.2", "agent_version: agent-0.9"), "no row of docs/CHANGELOG.md"),
            "spec of another version": (swap(r, "spec: 0c7ef2abfd94", "spec: 26e8981e5d35"), "no row of docs/CHANGELOG.md"),
            "case does not exist": (swap(r, "case: case_01", "case: case_99"), "there is no case_99"),
            "held-out case 08": (swap(r, "case: case_01", "case: case_08"), "held-out case"),
            "held-out case 10": (swap(r, "case: case_01", "case: case_10"), "held-out case"),
            "held-out case 12": (swap(r, "case: case_01", "case: case_12"), "held-out case"),
            "case without final labels": (swap(r, "case: case_01", "case: case_05"), "has no final labels"),
            "pass with a wrong criterion": (swap(r, "C2_conservative_4wk: supported", "C2_conservative_4wk: unsupported"), "written as pass, but C2_conservative_4wk"),
            "pass without citations": (swap(r, "citations_render: yes", "citations_render: no"), "the citations did not render"),
            "fail with nothing wrong": (swap(r, "outcome: pass", "outcome: fail"), "written as fail, but everything matches"),
        }
        for name, (record, expect) in cases.items():
            with self.subTest(name):
                # Pages are adjusted where needed so only the repository check can catch it.
                page = self.s.page
                if "case: case_" in name or "case" in expect:
                    num = re.search(r"case: case_(\d\d)", record).group(1)
                    page = page.replace("Claim/case01-claim", f"Claim/case{num}-claim")
                if "C2_conservative_4wk: unsupported" in record:
                    page = swap(page, "C2. Four weeks of conservative care\nMet", "C2. Four weeks of conservative care\nNot met")
                if "agent-0.9" in record:
                    page = page.replace("Agent agent-0.2", "Agent agent-0.9")
                if "26e8981e5d35" in record:
                    page = page.replace("(spec 0c7ef2abfd94)", "(spec 26e8981e5d35)")
                self.caught(expect, record, page)

    def test_approvals_on_but_routed(self):
        rec = swap(self.s.record, "mode: checklist", "mode: approvals_on")
        page = swap(self.s.page, "Checklist mode is on", "Approvals are on")
        self.caught("approvals_on mode expects approve", rec, page)

    def test_file_name_without_the_date(self):
        self.caught("must start with the record's date", name="demo-case01.md")

    def test_page_changes(self):
        p = self.s.page
        cases = {
            "another agent version": (swap(p, "Agent agent-0.2 (spec", "Agent agent-0.3 (spec"), "does not show \"Agent agent-0.2"),
            "another model": (swap(p, "model claude-sonnet-5. No stored", "model claude-opus-5. No stored"), "does not show \"Agent agent-0.2"),
            "another case's page": (p.replace("Claim/case01-claim", "Claim/case02-claim"), "is not case_01's record"),
            "no live result": (p.replace("Live run, just now", "The agent's decision (stored from the evaluation run)"), "shows no \"Live run, just now\""),
            "another outcome under the live heading": (swap(p, "Live run, just now\nSend to physician review", "Live run, just now\nRequest one document"), "the live result shows the outcome 'Request one document'"),
            "checklist mode not shown": (p.replace("Checklist mode is on", "Approvals are on"), "does not say checklist mode was on"),
            "another run time": (swap(p, "Done in 38 s.", "Done in 40 s."), "does not show \"Done in 38 s.\""),
            "C1 shown as met": (swap(p, "C1. Red flag\nNot met", "C1. Red flag\nMet"), "shows C1 as 'Met'"),
            "C4 shown as can't tell": (swap(p, "C4. Not a repeat of earlier imaging\nMet", "C4. Not a repeat of earlier imaging\nCan't tell from the record"), "shows C4 as"),
            "C2 heading missing": (swap(p, "C2. Four weeks of conservative care\n", ""), "shows C2 as None"),
            "a cited id not in the record": (swap(p, "\nnote:p5\n", "\nnote:p9\n"), "cites ids that are not in the saved record: note:p9"),
            "an entry missing from the record": (swap(p, "Procedure/case01-pt-01 2026-06-02", "Procedures were 2026-06-02"), "Procedure/case01-pt-01"),
            "passcode dots left in": (swap(p, "[masked]", "•" * 20), "passcode box's dots"),
        }
        for name, (page, expect) in cases.items():
            for new in (True, False):
                with self.subTest(name, new=new):
                    self.caught(expect, page=page, new=new)

    def test_citations_yes_but_nothing_cited(self):
        head, rest = self.s.page.split(csr.LIVE_HEADING, 1)
        live, listing = rest.split("\n" + csr.RECORD_HEADING + "\n", 1)
        live = "\n".join(l for l in live.split("\n") if not csr.CITED_ID.fullmatch(l.strip()))
        page = head + csr.LIVE_HEADING + live + "\n" + csr.RECORD_HEADING + "\n" + listing
        self.caught("cites no record entry", page=page)

    def test_approvals_on_record_with_a_checklist_page(self):
        rec = swap(self.s.record, "mode: checklist", "mode: approvals_on")
        rec = swap(rec, "routing: route", "routing: approve")
        page = swap(self.s.page, "Live run, just now\nSend to physician review", "Live run, just now\nApprove")
        self.caught("says checklist mode was on, but the record says approvals_on", rec, page)


class Main(unittest.TestCase):
    def setUp(self):
        self.s = Scratch()

    def tearDown(self):
        self.s.close()

    def test_exit_codes(self):
        self.s.put()
        new = ["--new", os.path.join(csr.FOLDER, RECORD)]
        self.assertEqual(csr.main([], self.s.root), 0)
        self.assertEqual(csr.main(new, self.s.root), 0)
        self.s.put(swap(self.s.record, "outcome: pass", "outcome: fail"))
        self.assertEqual(csr.main([], self.s.root), 0)    # pass or fail is judged only when a record is new
        self.assertEqual(csr.main(new, self.s.root), 1)
        self.assertEqual(csr.main(["--new", "docs/smoke-tests/missing.md"], self.s.root), 1)
        for f in os.listdir(self.s.folder):
            os.remove(os.path.join(self.s.folder, f))
        self.assertEqual(csr.main([], self.s.root), 0)    # no records yet is not an error

    def test_a_saved_page_with_no_record(self):
        self.s.put()
        write(os.path.join(self.s.folder, "2026-11-01-demo-case01-page.txt"), "stray")
        self.assertEqual(csr.orphan_pages(self.s.root), ["2026-11-01-demo-case01-page.txt: a saved page with no record naming it in page_text"])
        self.assertEqual(csr.main([], self.s.root), 1)


if __name__ == "__main__":
    unittest.main()
