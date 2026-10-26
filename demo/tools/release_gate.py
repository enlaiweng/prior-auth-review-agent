#!/usr/bin/env python3
"""The gate for switching the demo's approvals on (.github/workflows/demo-switch.yml).

Usage (from the repository root): python3 demo/tools/release_gate.py AGENT_VERSION
AGENT_VERSION is the version the deployed demo reports (/api/status). Exits 0 only when, on this commit:
  - docs/RELEASE_DECISION.md has a decision line starting "Go for release", with nothing left in [brackets], naming
    that exact agent version ("agent version agent-0.3,");
  - its hard gate line says "met" (zero false approvals);
  - its "Signed:" line carries a typed name (two words or more) and a date written YYYY-MM-DD;
  - docs/GOVERNANCE.md's model inventory does not say the agent is Suspended (a kill-switch trip not yet closed).
Otherwise it prints why, and approvals stay off.
"""
import re, sys


def problems(decision, governance, version):
    out = []
    lines = [l for l in decision.splitlines() if l.startswith("Go for release")]
    if len(lines) != 1:
        out.append('the decision line must start with "Go for release" (a No-go, or the unfilled template, keeps approvals off)')
    else:
        line = lines[0]
        if "[" in line or "]" in line:
            out.append("the decision line still has [brackets] to fill in")
        if not re.search(r"\bagent version " + re.escape(version) + r"(?=[\s,.;]|$)", line):
            out.append(f"the decision line must name the deployed agent version, \"agent version {version}\"")
    if not re.search(r"^Hard gate \(zero false approvals\): met\.", decision, re.M):
        out.append('the thresholds must say "Hard gate (zero false approvals): met."')
    if not re.search(r"^Signed: (?!\[)[A-Z][\w.'-]+(?: [A-Z][\w.'-]+)+.*\b20\d\d-[01]\d-[0-3]\d\b", decision, re.M):
        out.append('the "Signed:" line needs your typed name and a date written YYYY-MM-DD')
    m = re.search(r"^\| Lifecycle state \| ([^|]*)\|", governance, re.M)
    if m and "suspended" in m.group(1).lower():
        out.append("GOVERNANCE.md's model inventory says the agent is Suspended; record the exit from the kill-switch trip first")
    return out


def main(argv):
    if len(argv) != 1 or not re.fullmatch(r"agent-[0-9][0-9A-Za-z.-]*", argv[0]):
        print("::error title=No agent version::The demo did not report an agent version. Approvals stay off.")
        return 2
    found = problems(open("docs/RELEASE_DECISION.md", encoding="utf-8").read(),
                     open("docs/GOVERNANCE.md", encoding="utf-8").read(), argv[0])
    if found:
        print("::error title=Release decision not ready::" + " | ".join(found) + ". Approvals stay off.")
        return 1
    print(f"Release decision: signed Go for {argv[0]}, the version the demo is running.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
