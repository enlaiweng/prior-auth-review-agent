# Evaluation habits

1. Experiments run on the five development cases in dev_subset.txt (01 to 05) only, with the experiment key. They start automatically from Claude's working branch, and each agent pull request lists the experiment runs behind it.
2. Every prompt change cites the failure on cases 01 to 05 that justifies it, in CHANGELOG.md.
3. Policy passages are cached in data/policy/passages.json and never re-sent beyond the retrieved passage.
4. Full runs use the release key and wait for the owner's approval: the smoke run and run 1 (the 9 cases not held out), the fix loop, the release evaluation (one run on all 12, two more on the 9), and the vendor-update run.
5. Cases 08, 10, and 12 are held out: locked before any version of the agent existed, never used to change a prompt, and scored only in the release evaluation and the vendor-update run.
6. Commits containing Claude-written code, prompts, cases, or notes carry the trailer "AI-assisted: yes".
7. No workflow prints keys, the locked intended answers, or their key.
