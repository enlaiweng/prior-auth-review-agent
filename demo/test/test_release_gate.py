"""The gate for switching the demo's approvals on (demo/tools/release_gate.py). Run: python3 -m unittest demo/test/test_release_gate.py

It uses a frozen copy of the decision template (fixtures/release_decision_template.md), not the live
docs/RELEASE_DECISION.md, so signing the real record never breaks these tests.
"""
import os, re, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "demo", "tools"))
from release_gate import problems  # noqa: E402

TEMPLATE = open(os.path.join(ROOT, "demo/test/fixtures/release_decision_template.md"), encoding="utf-8").read()
GOV = "| Field | Value |\n| --- | --- |\n| Lifecycle state | In development |\n"
SPEC = "0c7ef2abfd94" + "a" * 52
DECISION = "[Go / No-go] for release [1.0], agent version [agent-x.y] (spec [first 12 characters of spec_sha256]), evaluated on golden set [1.0] on [date]."


def filled(text):
    text = (text.replace(DECISION, "Go for release 1.0, agent version agent-0.3 (spec 0c7ef2abfd94), evaluated on golden set 1.0 on 2026-11-10.")
            .replace("Hard gate (zero false approvals): [met / not met].", "Hard gate (zero false approvals): met.")
            .replace("Citation faithfulness at or above 95 percent: [met / not met].", "Citation faithfulness at or above 95 percent: met.")
            .replace("Signed: [the owner types his name and the date, written YYYY-MM-DD, here before merging].", "Signed: Enlai Weng, 2026-11-11"))
    while re.search(r"\[[^\[\]]*\]", text):   # every other placeholder, innermost first
        text = re.sub(r"\[[^\[\]]*\]", "filled", text)
    return text


GOOD = filled(TEMPLATE)


class Gate(unittest.TestCase):
    def test_the_fixture_matches_the_gate(self):
        self.assertIn(DECISION, TEMPLATE, "the template's decision line changed; update the fixture and this test")
        self.assertNotIn("[", GOOD)

    def test_allowed_only_for_a_signed_go_on_the_deployed_agent(self):
        self.assertEqual(problems(GOOD, GOV, "agent-0.3", SPEC), [])

    def test_refused(self):
        cases = {
            "the template as it is": (TEMPLATE, GOV, "agent-0.3", SPEC),
            "a newer agent deployed": (GOOD, GOV, "agent-0.4", SPEC),
            "a version that only starts the same": (GOOD, GOV, "agent-0.31", SPEC),
            "a signed patch version, a shorter one deployed": (GOOD.replace("agent-0.3 (spec", "agent-0.3.1 (spec"), GOV, "agent-0.3", SPEC),
            "same version name, changed agent": (GOOD, GOV, "agent-0.3", "1" * 64),
            "No-go": (GOOD.replace("Go for release 1.0", "No-go for release 1.0"), GOV, "agent-0.3", SPEC),
            "a bracket left in the decision line": (GOOD.replace("golden set 1.0", "golden set [1.0]"), GOV, "agent-0.3", SPEC),
            "a bracket left elsewhere (security scan)": (GOOD.replace("Prompt-injection test (instruction-bearing notes): filled", "Prompt-injection test (instruction-bearing notes): [n of n passed]"), GOV, "agent-0.3", SPEC),
            "hard gate not met": (GOOD.replace("approvals): met.", "approvals): not met."), GOV, "agent-0.3", SPEC),
            "citation faithfulness not met": (GOOD.replace("95 percent: met.", "95 percent: not met."), GOV, "agent-0.3", SPEC),
            "Signed: TBD 0000": (GOOD.replace("Signed: Enlai Weng, 2026-11-11", "Signed: TBD 0000"), GOV, "agent-0.3", SPEC),
            "no date": (GOOD.replace("Signed: Enlai Weng, 2026-11-11", "Signed: Enlai Weng"), GOV, "agent-0.3", SPEC),
            "Suspended": (GOOD, GOV.replace("In development", "Suspended (kill switch)"), "agent-0.3", SPEC),
            "no Lifecycle state row": (GOOD, GOV.replace("Lifecycle state", "State"), "agent-0.3", SPEC),
        }
        for name, args in cases.items():
            with self.subTest(name):
                self.assertNotEqual(problems(*args), [], name)

    def test_the_real_governance_file_has_the_row_the_gate_reads(self):
        gov = open(os.path.join(ROOT, "docs/GOVERNANCE.md"), encoding="utf-8").read()
        self.assertRegex(gov, r"(?m)^\| Lifecycle state \| [^|]+\|", "the gate reads GOVERNANCE.md's Lifecycle state row")


if __name__ == "__main__":
    unittest.main()
