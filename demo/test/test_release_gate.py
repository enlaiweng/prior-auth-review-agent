"""The gate for switching the demo's approvals on (demo/tools/release_gate.py). Run: python3 -m unittest demo/test/test_release_gate.py"""
import os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "demo", "tools"))
from release_gate import problems  # noqa: E402

TEMPLATE = open(os.path.join(ROOT, "docs/RELEASE_DECISION.md"), encoding="utf-8").read()
GOV = open(os.path.join(ROOT, "docs/GOVERNANCE.md"), encoding="utf-8").read()
DECISION = "[Go / No-go] for release [1.0], agent version [agent-x.y, as the demo's status shows it], evaluated on golden set [1.0] on [date]."
GOOD = (TEMPLATE.replace(DECISION, "Go for release 1.0, agent version agent-0.3, evaluated on golden set 1.0 on 2026-11-10.")
        .replace("Hard gate (zero false approvals): [met / not met].", "Hard gate (zero false approvals): met.")
        .replace("Signed: [the owner types his name and the date, written YYYY-MM-DD, here before merging].", "Signed: Enlai Weng, 2026-11-11"))


class Gate(unittest.TestCase):
    def test_the_template_is_filled_in_the_good_case(self):
        self.assertIn(DECISION, TEMPLATE, "the template's decision line changed; update this test")
        self.assertNotEqual(GOOD, TEMPLATE)

    def test_allowed_only_for_a_signed_go_on_the_deployed_version(self):
        self.assertEqual(problems(GOOD, GOV, "agent-0.3"), [])

    def test_refused(self):
        cases = {
            "the template as it is": (TEMPLATE, GOV, "agent-0.3"),
            "a newer agent deployed": (GOOD, GOV, "agent-0.4"),
            "a version that only starts the same": (GOOD, GOV, "agent-0.31"),
            "No-go": (GOOD.replace("Go for release 1.0", "No-go for release 1.0"), GOV, "agent-0.3"),
            "a bracket left": (GOOD.replace("golden set 1.0", "golden set [1.0]"), GOV, "agent-0.3"),
            "hard gate not met": (GOOD.replace("): met.", "): not met."), GOV, "agent-0.3"),
            "Signed: TBD 0000": (GOOD.replace("Signed: Enlai Weng, 2026-11-11", "Signed: TBD 0000"), GOV, "agent-0.3"),
            "no date": (GOOD.replace("Signed: Enlai Weng, 2026-11-11", "Signed: Enlai Weng"), GOV, "agent-0.3"),
            "Suspended": (GOOD, GOV.replace("| Lifecycle state | In development |", "| Lifecycle state | Suspended (kill switch) |"), "agent-0.3"),
        }
        for name, (d, g, v) in cases.items():
            with self.subTest(name):
                self.assertNotEqual(problems(d, g, v), [], name)


if __name__ == "__main__":
    unittest.main()
