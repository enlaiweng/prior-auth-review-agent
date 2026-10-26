# The public demo

A one-page website where anyone can look at the twelve made-up cases and see what the agent decided, and where people
you give a passcode to can run the agent live on a case. It runs on Cloudflare's free plan as one Worker (a small
program that answers web requests) with one small D1 database (it only counts live runs). Decided in
docs/ARCHITECTURE.md, ADR-7, ADR-9 and ADR-14.

It runs the same agent code the evaluation scores (`agent/agent.js`), unchanged.

## What a visitor sees

- **The twelve cases**, each with its full record: the request, the patient line, the conditions, visits, procedures,
  medications, observations and the visit note, every entry with its id.
- **The agent's decision** for each case, once a stored run is set (below): approve, request one document, or send
  to physician review, with the fixed rule's reasons and, for each of the four criteria, the status, a short
  explanation, the evidence ids (click one to find it in the record) and the policy words it turns on.
- **Run it live**: with the passcode, sends the case to the agent now and shows the result a minute or two later.
- **A banner** that says which mode the demo is in.

The word "deny" never appears as an outcome. The agent has no deny output.

## The two modes

- **Checklist mode** (the default, and the kill switch): approvals and document requests are off, so every case is
  sent to physician review. The criteria and evidence are still shown.
- **Approvals on**: the fixed rule can approve or request a document.

Approvals are on only when the Worker's `CHECKLIST_MODE` setting is exactly `false`. Missing, mistyped or anything
else means checklist mode. Every deploy sets it to checklist mode. Only the **Demo switch** workflow turns approvals
on, and it refuses unless `docs/RELEASE_DECISION.md` on main says "Go for release" for the agent version the demo is
running and carries your typed, dated "Signed:" line.

Stored decisions follow the mode too. The demo never shows the outcome written in a stored file; it applies the fixed
rule again to the stored criteria, under the current mode. So the off switch covers everything on screen.

## Live runs: the guards

| Guard | What it does |
| --- | --- |
| Passcode | At least 12 characters, set by you. A wrong one is refused without reaching the model. |
| Wrong passcodes | After 5 wrong passcodes in ten minutes from one visitor, live runs pause for that visitor; after 50 from everyone together, for everyone. Each check is counted in one database step, so many guesses sent at once can't slip past. |
| Caps | 2 live runs a minute and 20 a day, across all visitors (roughly $2 a day, at about $0.10 a run; a run that has to retry costs more). Settings `LIVE_PER_MINUTE` and `LIVE_PER_DAY` in `wrangler.toml`. |
| Held-out cases | 08, 10 and 12 never run live. They're scored only in the release evaluation. |
| Unsettled cases | A case runs live only once its final labels are in place, the same rule the evaluation runs follow. |
| Before run 1 | Live runs are limited to the development cases, 01 to 05, so run 1 stays the first look at the others (EVAL_PLAN.md). |
| Outside reader | Cases an outside clinician is still reading neither run live nor show a stored decision, so nothing here can shape their reading. |
| Time limit | A live run gives up after four minutes and routes, with the error shown. |
| The key | The demo's own key, in its own Anthropic workspace with a spend limit. It never appears in any page or answer. |

The Worker keeps no request logs. Its database holds one row per live-run attempt (time, case, outcome), deleted
after three days. On wrong-passcode rows only, it also keeps a fingerprint of the visitor's address and the day,
made with the passcode as a key, so it can't be turned back into an address and changes daily. No address,
passcode or browser detail is stored.

## Which cases run live: `live_scope.json`

| Setting | Now | Change it when |
| --- | --- | --- |
| `scope` | `dev`: only cases 01 to 05 | Run 1 is done: set it to `nine` (every case not held out). |
| `outside_reader_open` | 04, 05, 07, 10 | Dr. Dabs's labels are merged: remove his cases (an empty list is `[]`). |

With today's settings, cases 01, 02 and 03 run live. Each change reaches the demo at its next deploy.

## Stored decisions

`demo/stored_run.txt` says which finished evaluation run the viewer shows: `none` for now, and after the release
evaluation, its folder under `eval/runs/`. The build refuses a run that didn't finish, a run made by a different
agent version, or a decision for a case without final labels.

## Deploying it (you)

You need two secrets you already have in the GitHub **release** environment (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`) and the demo key (`ANTHROPIC_DEMO_KEY`), plus one new one:

| Name in GitHub | What it is |
| --- | --- |
| `DEMO_PASSCODE` | The passcode you give people for live runs. At least 12 characters. Something you can read out loud helps, for example three or four random words joined by hyphens from your password manager's generator. Keep it in your password manager. |

Then, on the **Actions** tab: **Deploy demo**, **Run workflow** (Branch: main), and approve it. The run's summary
gives the viewer's address and the smoke test to do next (RUNBOOK.md, Deploy). Changing the passcode needs a new
deploy, and every deploy turns approvals off.

To switch approvals on or off: **Actions** tab, **Demo switch**, **Run workflow**, choose `off` or `on`, and approve.
`on` is refused unless `docs/RELEASE_DECISION.md` has your signed Go for the exact agent version the demo is
running, with the hard gate met (`demo/tools/release_gate.py`).

Never use the **Rollback** or version buttons in Cloudflare's dashboard for this Worker. Each Cloudflare version
carries its own settings, so going back to an older version could turn approvals back on without the release gate.
Roll back only with the workflows (RUNBOOK.md, Roll back).

## How it's checked

`.github/workflows/demo-checks.yml` runs on every change to the demo, the agent, the cases or the plan:

- the Worker builds and stays far under Cloudflare's size limit;
- re-deciding stored decisions agrees with the agent itself on every case, every report shape and both modes, and
  the build refuses what it should (`test/decide.test.mjs`);
- every route of the Worker, against the real Worker in Cloudflare's local runtime and a fake model: each refusal
  (with no model call and no count), both modes and eight near-misses of "false", the caps (including four requests
  at the same moment), the wrong-passcode pause, failed and hung model calls, the progress lines, and stored decisions
  (`test/api.test.mjs`);
- the viewer in a real browser, on a laptop screen and a phone screen (`test/viewer.test.mjs`);
- the release gate the switch uses, on good and bad decision files (`test/test_release_gate.py`).

Nothing in the checks touches Cloudflare or Anthropic.

## Running it on a computer (for development)

From the repository root: `python3 demo/build_demo.py`, then in `demo/`: `npm ci`, and
`npx wrangler d1 migrations apply prior-auth-demo --local`, then `npx wrangler dev --local`. Without a key and a
passcode, live runs say they aren't set up.
