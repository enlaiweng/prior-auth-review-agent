# Demo smoke test records

After every deployment of the demo, the owner runs the smoke test in docs/RUNBOOK.md (Deploy): open the viewer,
confirm the twelve cases are listed and every stored decision is routed in checklist mode, then run case 01 live with
the passcode and compare its four criteria with the final labels. This folder is the written record of each of those
tests, so a test that was done once never has to be paid for again just to prove it happened.

Each test is two files, named by the date:

- `YYYY-MM-DD-demo-caseNN.md`: a short header the checker reads (date, who ran it, which deployment, the mode, the
  agent version and spec, the model, the case, the run time, the routing, each criterion's status, whether the
  citations rendered, and pass or fail), followed by a plain-language summary.
- `YYYY-MM-DD-demo-caseNN-page.txt`: the page's text, copied from the browser right after the run. It is saved as is,
  except that the passcode box's dots are replaced with `[masked]`, since their number would give away the passcode's
  length.

Claude adds both by pull request from what the owner sends; the owner's merge is the approval. A record is never
edited after it is merged: a later test gets its own files.

The **Demo checks** workflow runs `demo/tools/check_smoke_records.py` on every change here. It checks in two ways:

- **Every record, every time,** against its own saved page: the header is complete and well formed, and the page
  shows the same agent, spec, model, case, mode, run time, outcome and criterion statuses; every id the live run cited
  is in the page's record; the passcode is masked; and every saved page belongs to a record.
- **A record when it is added,** against the repository as it is then: its agent version and spec appear together in
  docs/CHANGELOG.md, its case has final labels and is not held out, and it says pass only when every criterion and the
  routing match the final labels (and fail only when they don't).

The second check runs only once because a merged record is never changed: if a case were re-settled later, or the
changelog rewritten, a record that was right on the day would otherwise fail for good. The checker does not check the
demo's other live-run limits in `demo/live_scope.json`, since those change over time. Its own tests, on frozen copies
of the labels and the changelog, are in `demo/test/test_smoke_records.py`.
