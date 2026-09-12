# Evaluation habits

1. All prompt iteration runs on the five-case development subset in dev_subset.txt.
2. Policy passages are cached in data/policy/passages.json and never re-sent beyond the retrieved passage.
3. The full golden set is run only at gates: the week-two smoke run, the end of the fix loop, and the release evaluation.
4. Any commit containing Claude-written code or note text carries the trailer "AI-assisted: yes" in the commit description.
