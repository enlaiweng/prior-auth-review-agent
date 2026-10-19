# Evaluation habits

1. Experiments run with the experiment key: on the five development cases in dev_subset.txt (01 to 05) until run 1, and on any of the 9 cases not held out after it; never on cases 08, 10, or 12. They start automatically from Claude's working branch, and each agent pull request lists the experiment runs behind it.
2. Every prompt change cites, in CHANGELOG.md, the failure that justifies it, on a case that is not held out (cases 01 to 05 before run 1).
3. Policy passages are cached in data/policy/passages.json and never re-sent beyond the retrieved passage.
4. Full runs use the release key and wait for the owner's approval: the smoke run and run 1 (the 9 cases not held out), the fix loop, the release evaluation (three runs on all 12), and the vendor-update run.
5. Cases 08, 10, and 12 are held out: locked before any version of the agent existed, never used to change a prompt, and scored only in the release evaluation and the vendor-update run.
6. Commits containing Claude-written code, prompts, cases, or notes are authored as Claude and carry the trailer "AI-assisted: yes" (missing or misplaced on 17 commits made from 2026-10-13 to 2026-10-15; CHANGELOG.md).
7. No workflow prints keys, the locked intended answers, or their key.
8. Runs go through the Agent run workflow (eval/run_and_score.sh): eval/run_agent.mjs writes one decision per case and a record of the run (agent version, spec fingerprint, settings, the model version returned, tokens, a cost estimate), and eval/score.py scores it against final labels only. Blind and Gemini labels are never used for scoring.
9. The held-out cases are written into eval/run_agent.mjs, which checks them against EVAL_PLAN.md before every run; eval/dev_subset.txt names the experiment cases. On the experiments budget, eval/run_agent.mjs refuses any case outside the smoke case and eval/dev_subset.txt, and the run stops if the branch's dev_subset.txt or EVAL_PLAN.md differs from main's. Held-out cases run only in a run on all 12. No golden case runs before its final labels are merged on main, so the agent's view of a case can never reach the owner before he has labeled it and settled its labels.

