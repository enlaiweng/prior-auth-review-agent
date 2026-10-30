#!/usr/bin/env python3
"""The gate for switching the demo's approvals on (.github/workflows/demo-switch.yml).

Usage (from the repository root): python3 demo/tools/release_gate.py AGENT_VERSION SPEC_SHA256
Both come from the deployed demo's status (/api/status): the agent version and its spec fingerprint. Exits 0 only when,
on this commit:
  - docs/RELEASE_DECISION.md has nothing left in [brackets] anywhere: every part of the record is filled in;
  - its decision line starts "Go for release" and names that exact agent version and the first 12 characters of
    its spec fingerprint ("agent version agent-0.3 (spec 0c7ef2abfd94)"), so a later agent change that kept the
    version name is still refused;
  - its hard gate line and its citation faithfulness threshold say "met";
  - its "Signed:" line carries a typed name (two words or more) and a date written YYYY-MM-DD;
  - docs/GOVERNANCE.md's model inventory has a Lifecycle state that is not Suspended (a kill-switch trip not yet
    closed). A missing Lifecycle state row also keeps approvals off.
Otherwise it prints why, and approvals stay off.
"""
import re, sys


def problems(decision, governance, version, spec):
    out = []
    if "[" in decision or "]" in decision:
        out.append("RELEASE_DECISION.md still has [brackets] to fill in")
    lines = [l for l in decision.splitlines() if l.startswith("Go for release")]
    if len(lines) != 1:
        out.append('the decision line must start with "Go for release" (a No-go, or the unfilled template, keeps approvals off)')
    else:
        line = lines[0]
        named = "agent version " + version + " (spec " + spec[:12] + ")"
        if not re.search(r"\b" + re.escape(named), line):
            out.append(f"the decision line must name the deployed agent, \"{named}\"")
    if not re.search(r"^Hard gate \(zero false approvals\): met\.", decision, re.M):
        out.append('the thresholds must say "Hard gate (zero false approvals): met."')
    if not re.search(r"Citation faithfulness at or above 95 percent: met\.", decision):
        out.append('the thresholds must say "Citation faithfulness at or above 95 percent: met."')
    if not re.search(r"^Signed: (?!\[)[A-Z][\w.'-]+(?: [A-Z][\w.'-]+)+.*\b20\d\d-[01]\d-[0-3]\d\b", decision, re.M):
        out.append('the "Signed:" line needs your typed name and a date written YYYY-MM-DD')
    m = re.search(r"^\| Lifecycle state \| ([^|]*)\|", governance, re.M)
    if not m:
        out.append("GOVERNANCE.md's model inventory has no Lifecycle state row")
    elif "suspended" in m.group(1).lower():
        out.append("GOVERNANCE.md's model inventory says the agent is Suspended; record the exit from the kill-switch trip first")
    return out


def main(argv):
    if len(argv) != 2 or not re.fullmatch(r"agent-[0-9][0-9A-Za-z.-]*", argv[0]) or not re.fullmatch(r"[0-9a-f]{64}", argv[1]):
        print("::error title=No agent version::The demo did not report its agent version and spec fingerprint. Approvals stay off.")
        return 2
    found = problems(open("docs/RELEASE_DECISION.md", encoding="utf-8").read(),
                     open("docs/GOVERNANCE.md", encoding="utf-8").read(), argv[0], argv[1])
    if found:
        print("::error title=Release decision not ready::" + " | ".join(found) + ". Approvals stay off.")
        return 1
    print(f"Release decision: signed Go for {argv[0]} (spec {argv[1][:12]}), the agent the demo is running.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
