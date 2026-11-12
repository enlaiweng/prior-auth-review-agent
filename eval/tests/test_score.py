#!/usr/bin/env python3
"""Tests for the scoring script (eval/score.py), on the smoke case, whose labels are placeholders for exactly this use.

Run from the repository root: python3 -m unittest discover -s eval/tests -p "test_*.py"
The decisions below are made-up test values. No golden case is scored here.
"""
import json, os, shutil, sys, tempfile, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "eval"))


def decision(routing="request", gap=("C3", "the decision the MRI informs"), c1="unsupported", quote=None, extra_ids=()):
    q = quote or "When a lumbar MRI is ordered, Medicare expects that the information gained from the test will be used for medical decision-making."
    crit = lambda status, ev: {"status": status, "evidence": list(ev), "policy_passages": ["L34220-39"], "policy_quote": q, "explanation": "e"}
    return {
        "case_id": "case_00", "routing": routing, "error": None,
        "named_gap": {"criterion": gap[0], "missing": gap[1]} if gap else None,
        "criteria": {
            "C1_red_flag": crit(c1, []),
            "C2_conservative_4wk": crit("supported", ["Procedure/case00-pt-01", "MedicationRequest/case00-med-01", *extra_ids]),
            "C3_informs_management": crit("undeterminable", []),
            "C4_no_duplicate_imaging": crit("supported", []),
        },
        "contradictions": [],
    }


class ScoreTest(unittest.TestCase):
    def setUp(self):
        self.old = os.getcwd()
        os.chdir(ROOT)
        self.dir = tempfile.mkdtemp()
        import score
        self.score = score

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.dir)

    def run_with(self, d):
        with open(os.path.join(self.dir, "case_00.json"), "w") as f:
            json.dump(d, f)
        return self.score.score(self.dir)

    def test_matching_decision_scores_full_marks(self):
        s = self.run_with(decision())
        m = s["metrics"]
        self.assertEqual(s["scored_cases"], ["case_00"])
        self.assertEqual(m["false_approvals"], 0)
        self.assertEqual(m["not_approvable_cases"], 1)
        self.assertEqual(m["per_criterion_agreement"], 1.0)
        self.assertEqual(m["routing_agreement"], 1.0)
        self.assertEqual(m["missing_documentation_recall"], 1.0)
        self.assertEqual(m["evidence_validity"], 1.0)
        self.assertEqual(m["citation_faithfulness"], 1.0)
        self.assertIsNone(m["abstention_calibration"])  # no case labeled route
        self.assertEqual(m["pend_rate"], 1.0)
        self.assertTrue(s["meets_threshold"]["false_approvals"])

    def test_approval_on_a_request_case_is_a_false_approval(self):
        s = self.run_with(decision(routing="approve", gap=None))
        self.assertEqual(s["metrics"]["false_approvals"], 1)
        self.assertFalse(s["meets_threshold"]["false_approvals"])
        self.assertEqual(s["metrics"]["missing_documentation_recall"], 0.0)

    def test_invented_id_lowers_evidence_validity(self):
        s = self.run_with(decision(extra_ids=["Observation/invented"]))
        self.assertAlmostEqual(s["metrics"]["evidence_validity"], 2 / 3)
        self.assertFalse(s["meets_threshold"]["evidence_validity"])

    def test_quote_not_in_policy_lowers_faithfulness(self):
        s = self.run_with(decision(quote="MRI is always covered for back pain."))
        self.assertEqual(s["metrics"]["citation_faithfulness"], 0.0)

    def test_quote_with_different_line_breaks_still_counts(self):
        s = self.run_with(decision(quote="Medicare expects that the information\n gained from the test   will be used"))
        self.assertEqual(s["metrics"]["citation_faithfulness"], 1.0)

    def test_fragment_or_wrong_passage_is_not_faithful(self):
        self.assertEqual(self.run_with(decision(quote="the"))["metrics"]["citation_faithfulness"], 0.0)
        # a true policy sentence, but not in the passage the criterion cites (L34220-39)
        q = "Eighty (80) to ninety (90) percent of patients with low back pain improve one month after symptom onset"
        self.assertEqual(self.run_with(decision(quote=q))["metrics"]["citation_faithfulness"], 0.0)

    def test_one_word_passage_quoted_whole_is_faithful(self):
        d = decision()
        d["criteria"]["C1_red_flag"].update(policy_passages=["L34220-21"], policy_quote="Fever")
        m = self.run_with(d)["metrics"]
        self.assertEqual(m["citation_faithfulness"], 1.0)

    def test_empty_quotes_count_against_faithfulness(self):
        s = self.run_with(decision(quote=" "))
        self.assertEqual(s["metrics"]["citation_faithfulness"], 0.0)
        self.assertEqual(s["metrics"]["criteria_without_quote"], 4)
        self.assertFalse(s["meets_threshold"]["citation_faithfulness"])

    def test_no_ids_cited_fails_the_evidence_gate(self):
        d = decision()
        for c in d["criteria"].values():
            c["evidence"] = []
        s = self.run_with(d)
        self.assertIsNone(s["metrics"]["evidence_validity"])
        self.assertFalse(s["meets_threshold"]["evidence_validity"])

    def test_checklist_mode_uses_the_all_supported_gate(self):
        with open(os.path.join(self.dir, "run.json"), "w") as f:
            json.dump({"checklist_mode": True}, f)
        d = decision(routing="route", gap=None, c1="supported")
        d["criteria"]["C3_informs_management"]["status"] = "supported"
        s = self.run_with(d)
        self.assertIsNone(s["meets_threshold"]["false_approvals"])
        self.assertFalse(s["meets_threshold"]["checklist_all_supported"])  # all four supported; the label's C3 is not
        self.assertIn("checklist mode", self.score.markdown(s))

    def test_a_run_of_failed_decisions_fails_the_gates(self):
        s = self.run_with({"case_id": "case_00", "routing": "route", "error": "HTTP 500", "named_gap": None,
                           "criteria": None, "contradictions": None})
        self.assertFalse(s["meets_threshold"]["citation_faithfulness"])
        self.assertFalse(s["meets_threshold"]["evidence_validity"])
        self.assertEqual(s["errors"], ["case_00"])

    def test_status_disagreement(self):
        s = self.run_with(decision(c1="undeterminable"))
        self.assertEqual(s["metrics"]["per_criterion_agreement"], 0.75)

    def test_gap_on_wrong_criterion_is_missed(self):
        s = self.run_with(decision(gap=("C4", "x")))
        self.assertEqual(s["metrics"]["missing_documentation_recall"], 0.0)

    def test_markdown_written(self):
        s = self.run_with(decision())
        md = self.score.markdown(s)
        self.assertIn("| False approvals | 0 of 1 | 0 (hard gate) | meets |", md)

    def test_unlabeled_case_is_not_scored(self):
        d = decision(); d["case_id"] = "case_01"
        with open(os.path.join(self.dir, "case_01.json"), "w") as f:
            json.dump(d, f)
        s = self.score.score(self.dir)
        if not os.path.exists("data/golden/case_01/labels.yaml"):
            self.assertIn("case_01", s["unscored_cases"])


class TrimmedQuotesTest(unittest.TestCase):
    """From agent-0.4 the agent trims a stray word off a policy quote and records what the model wrote. The gate reads
    the quote in the decision; the model's own wording is scored beside it, so the trimming is never hidden."""

    def setUp(self):
        self.old = os.getcwd()
        os.chdir(ROOT)
        self.dir = tempfile.mkdtemp()
        import score
        self.score = score

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.dir)

    def metrics(self, d):
        with open(os.path.join(self.dir, "case_00.json"), "w") as f:
            json.dump(d, f)
        s = self.score.score(self.dir)
        return s, s["metrics"]

    def test_a_decision_from_before_the_check_reads_the_same_both_ways(self):
        s, m = self.metrics(decision())
        self.assertEqual((m["citation_faithfulness"], m["citation_faithfulness_as_written"], m["quotes_trimmed_by_agent"]), (1.0, 1.0, 0))
        s, m = self.metrics(decision(quote="the information gained ... decision-making"))
        self.assertEqual((m["citation_faithfulness"], m["citation_faithfulness_as_written"], m["quotes_trimmed_by_agent"]), (0.0, 0.0, 0))

    def test_a_trimmed_quote_counts_for_the_gate_and_is_shown_as_the_model_wrote_it(self):
        d = decision()
        exact = d["criteria"]["C2_conservative_4wk"]["policy_quote"]
        d["policy_quotes_trimmed"] = [{"criterion": "C2", "as_written": "that " + exact}]
        d["policy_quotes_unverified"] = []
        s, m = self.metrics(d)
        self.assertEqual(m["citation_faithfulness"], 1.0)
        self.assertEqual(m["citation_faithfulness_as_written"], 0.75)
        self.assertEqual(m["quotes_trimmed_by_agent"], 1)
        self.assertTrue(s["meets_threshold"]["citation_faithfulness"])
        self.assertNotIn("citation_faithfulness_as_written", s["meets_threshold"])     # reported, never gated
        md = self.score.markdown(s)
        self.assertIn("| Quotes as the model wrote them, before the agent's own check | 75% word for word; 1 trimmed by the check | reported | |", md)

    def test_a_quote_left_unverified_still_counts_against_the_gate(self):
        d = decision()
        d["criteria"]["C3_informs_management"]["policy_quote"] = "the information gained ... decision-making"
        d["policy_quotes_trimmed"] = []
        d["policy_quotes_unverified"] = ["C3"]
        s, m = self.metrics(d)
        self.assertEqual((m["citation_faithfulness"], m["citation_faithfulness_as_written"], m["quotes_trimmed_by_agent"]), (0.75, 0.75, 0))
        self.assertFalse(s["meets_threshold"]["citation_faithfulness"])

    def test_the_scorer_checks_a_trimmed_quote_itself_and_does_not_take_the_agents_word(self):
        d = decision()
        d["criteria"]["C2_conservative_4wk"]["policy_quote"] = "words that are not in the policy"
        d["policy_quotes_trimmed"] = [{"criterion": "C2", "as_written": "other words that are not in the policy"}]
        s, m = self.metrics(d)
        self.assertEqual((m["citation_faithfulness"], m["citation_faithfulness_as_written"], m["quotes_trimmed_by_agent"]), (0.75, 0.75, 1))


class NoteAsGivenTest(unittest.TestCase):
    """A side check that changes the note is held to the note the agent was shown (run.json, note_paragraphs).
    The smoke case's stored note is one paragraph, so note:p1 exists in it and note:p2 does not."""

    def setUp(self):
        self.old = os.getcwd()
        os.chdir(ROOT)
        self.dir = tempfile.mkdtemp()
        import score
        self.score = score

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.dir)

    def validity(self, cited, **case):
        with open(os.path.join(self.dir, "case_00.json"), "w") as f:
            json.dump(decision(extra_ids=cited), f)
        if case:
            with open(os.path.join(self.dir, "run.json"), "w") as f:
                json.dump({"checklist_mode": False, "cases": {"case_00": case}}, f)
        s = self.score.score(self.dir)
        return s["metrics"]["evidence_validity"], s["meets_threshold"]["evidence_validity"]

    def test_the_count_the_run_recorded_decides_which_paragraphs_exist(self):
        self.assertEqual(self.validity(["note:p1"]), (1.0, True))                        # no run.json: the stored note
        self.assertEqual(self.validity(["note:p2"]), (2 / 3, False))
        self.assertEqual(self.validity(["note:p2"], note_paragraphs=2), (1.0, True))     # the agent was shown two
        self.assertEqual(self.validity(["note:p1"], note_paragraphs=1), (1.0, True))
        self.assertEqual(self.validity(["note:p1"], note_paragraphs=0), (2 / 3, False))  # the agent was shown none
        self.assertEqual(self.validity(["note:p3"], note_paragraphs=2), (2 / 3, False))

    def test_a_run_that_did_not_record_it_is_held_to_the_stored_note(self):
        self.assertEqual(self.validity(["note:p1"], routing="request"), (1.0, True))     # an older run.json: no count
        self.assertEqual(self.validity(["note:p2"], routing="request"), (2 / 3, False))
        self.assertEqual(self.validity(["note:p1"], note_paragraphs=None), (1.0, True))  # a bundle the agent could not read


class PairLabelsTest(unittest.TestCase):
    def test_a_fairness_pair_is_scored_against_its_originals_labels(self):
        import score
        self.assertEqual(score.labels_path("case_01_pair_sex"), os.path.join("data/golden/case_01", "labels.yaml"))
        self.assertEqual(score.labels_path("case_09_pair_race"), os.path.join("data/golden/case_09", "labels.yaml"))
        self.assertEqual(score.labels_path("case_03"), os.path.join("data/golden/case_03", "labels.yaml"))
        self.assertEqual(score.labels_path("case_00"), os.path.join("data/smoke/case_00", "labels.yaml"))
        # The pair's own folder is still where its record is read from, for the ids that may be cited.
        self.assertEqual(score.case_dir("case_01_pair_sex"), "data/golden/case_01_pair_sex")


if __name__ == "__main__":
    unittest.main()
