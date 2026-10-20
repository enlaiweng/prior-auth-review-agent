# The online labeling site

A small website for **outside labelers**: a clinician or utilization review nurse you invite to label some cases independently. It runs on Cloudflare's free plan as one Worker (a program that answers web requests) with one D1 database (Cloudflare's small SQL database). Decided in docs/ARCHITECTURE.md, ADR-13.

Your own blind labels don't go through this site. They stay on `eval/labeling/labeling.html` and the blind-labels pull request, where the checks lock them after merge.

## What a labeler sees

1. **Their personal link.** You send it yourself. Opening it shows a short page naming who the link is for, with a **Continue** button. Clicking it signs them in on that browser for 60 days.
   - Opening the link alone changes nothing, so email and chat link-checkers can't sign anyone in.
   - If the browser is already signed in as someone else, the page says so before switching.
2. **A welcome page.** It says the project is public. They enter the name and role to be credited by, and tick two boxes:
   - their labels, with that name and role, may be published in the project's public repository and datasheet;
   - they'll label on their own: no AI tools on the cases, no searching for how to label a case, no discussing a case until it's submitted.
3. **Their home page.**
   - What labeling is.
   - The optional training: `eval/labeling/training.html` with the guided walkthrough, plus a note at the top for invited labelers saying which parts apply to them.
   - A box to say they've done the training.
   - **Only the cases you assigned them**, with each one's status.
4. **The labeling view.** The same record viewer and form as the labeling page, plus the "Policy and criteria" panel.
   - Changes save as they go, and the line under the form says whether the last change is saved.
   - If a save fails, it says so and offers **Try saving again**. Closing the tab with an unsaved change asks first.
   - **Submit** sends the answers exactly as shown and locks the case. If the last change isn't saved, it refuses.
   - **Clear this case**, before submitting, empties that one case so they can start it again. It asks first, and their other cases are kept. After submitting, only you can clear or reopen it.

A labeler never sees anyone else's labels. The site never holds your labels, Gemini's, or the locked intended answers. The practice cases' worked answers appear only inside the training, as in the repository.

**Two tabs or devices.** Every save says which version it was based on. A save from an out-of-date copy is refused, never merged; the page then shows the latest saved answers and says why. If the cases are updated while someone has the page open, their next save asks them to reload.

## What you see (the admin page, `/admin`)

Sign in with the admin key (the value of the release environment's `LABELING_ADMIN_KEY`). The tab keeps it while open; click **Sign out** when you're done. From the admin page you can:

- **Invite a labeler.** Give their name and, optionally, an email and a note for your records, and choose cases. You get their personal link once: copy it and send it to them.
- **See each labeler's progress:**
  - their id;
  - whether they agreed, and how they asked to be credited;
  - whether they said they did the training;
  - each case's status: not started, started, ready to submit, or submitted, with the time.
- **Change their cases.** A case with a saved label stays assigned.
- **Make a new link** (the old one stops working at once), or **turn a link off.**
- **Reopen a submitted case,** with a reason. The reason goes into the activity log. Their answers stay, and they can change and submit them again.
- **Clear one case** for one person, submitted or not, with a reason (**Clear it**, click twice to confirm). Their answers for that case are deleted so they can start it again; the case stays assigned and drops out of the download until they submit it again. The activity log keeps the reason and what was cleared.
- **Remove a person's details**, only if they ask. This deletes their labels and details from the site; the activity log keeps what happened and when, with the details cleared.
- **Download submitted labels.** One JSON file. Each label carries:
  - who labeled it: their credit name and role, and when they agreed;
  - when it was submitted;
  - whether the case is a golden or a practice case;
  - a fingerprint of the case record their page showed.
- **Activity.** The audit trail:
  - invites;
  - sign-ins: Continue clicks only, never link-checkers;
  - consent and first saves;
  - submits, each with exactly what was locked;
  - reopenings, clears (with what was cleared), link changes, and removals.

  Each entry is written together with the change it records. The database refuses to delete or rewrite entries, except clearing a removed person's details.

## Identity, and what the database keeps

- **Identity is the personal link.** The link holds a random 256-bit token. The database stores only its SHA-256 fingerprint, so even a copy of the database can't be used to sign in. Anyone holding a link is recorded as that person, so send each link only to its person. If a link might have been forwarded, make a new one and look at the activity log.
- **For each labeler:** the name you typed, the optional email and note, the credit name and role they entered, when they agreed, and when they said they did the training.
- **For each label:**
  - the answers: statuses, evidence ids, routing, and gap;
  - its version number;
  - when it was last saved and when it was submitted;
  - a fingerprint of the case record and of all the case content the page was loaded with.

  Evidence must be ids in that case, and only approve, request, and route are accepted.
- **Not kept by the site:** IP addresses, browser details, request logs (they're turned off for this Worker), or anything about a visit beyond the activity log. Cloudflare keeps its usual traffic statistics for your account. The cases are synthetic; no real patient is in them.
- **Security:**
  - Each page may run only its own script; any other script is blocked.
  - Pages can't be framed, send no referrer, and aren't cached.
  - The sign-in cookie can be set only by this exact site.
  - Every change must carry a header that only the site's own pages send, so another site can't act on a labeler's behalf.

## Deploying it (you, once)

You need three secrets in the GitHub **release** environment. The deployment planned for week 3 will use the first two as well.

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token from the **Edit Cloudflare Workers** template, with **Account, D1, Edit** added |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |
| `LABELING_ADMIN_KEY` | A long random value with no spaces, at least 24 characters. Make it with `openssl rand -base64 33` in Terminal, or a password manager's generator, and keep it in your password manager; you sign in to the admin page with it |

Your Cloudflare account also needs a **workers.dev subdomain** (the Workers & Pages page of the Cloudflare dashboard shows it).

To deploy, run **Actions, Deploy labeling site, Run workflow**, keep **Branch: main** (on any other branch it does nothing), and approve it. The workflow:
1. checks the content and runs the tests;
2. creates the database the first time and applies its migrations;
3. deploys;
4. sets the admin key;
5. checks that the site answers and the admin key works.

The run's summary shows the address. Step-by-step instructions are in the Claude project's guide, `claude/labeling-site-setup-2026-10-20.md`. Running it again is safe: it keeps the database and its data.

**Changing the admin key:** update `LABELING_ADMIN_KEY` in the release environment and run the workflow again.

## Getting labels into the repository

Download the submitted labels from the admin page and give the file to Claude. Each person's labels become files beside the other readers' (one per case, carrying who and when), through a pull request you review. Practice-case labels are left out. The datasheet records how outside labels were collected and who gave them.

## Removing someone's details

If a labeler asks to be removed, use **Remove this person's details** on the admin page (click twice to confirm). If their labels were already copied into the repository, Claude removes them there through a pull request, and the change is recorded in the decision log. Earlier versions stay in the repository's history, which the welcome page tells labelers before they agree.

## Known limits

- A personal link is a password: anyone who has it can label as that person.
- Cloudflare's free plan allows 100,000 requests a day. Someone determined could use that up and take the site offline for the day. Nothing would be lost, and at this size it's unlikely.
- The labeling view is built for a computer. It works on a phone, but the form sits below the whole record; a **Go to the form** button jumps there.

## Shutting it down

In the Cloudflare dashboard, delete the Worker `prior-auth-labeling`, then the D1 database `prior-auth-labeling`, after downloading anything you want to keep.

## How it's tested

Four sets of tests run on every change to the site, in the **Labeling site checks** workflow. All use the real Worker code with an empty local database, so nothing touches Cloudflare.

- **API tests** (`test/api.test.mjs`) send requests straight to the site and check its answers: who may see and change what, the locking, the audit trail, and the security headers.
- **Positive and negative tests of every input** (`test/inputs.test.mjs`, 209 tests). A positive test sends something valid and checks it's accepted and does what it should. A negative test sends something invalid and checks three things: it's refused, the refusal gives the right reason, and nothing changed. Nothing changed means the people, their cases, the download, and the activity log all look exactly as before, and so does the labeler's own copy of the label. They cover:
  - every address;
  - signing in;
  - the welcome page;
  - the training checkbox;
  - reading, saving, and submitting a label, including every field's allowed values, wrong types, and length limits, plus saves or submits sent at the same moment;
  - the admin key;
  - every owner action.
- **Positive and negative tests of each form** (`test/forms.test.mjs`, 31 tests), in a real browser. Each form gets filled in correctly, then wrongly or halfway. The tests check that the person sees a plain message or a greyed-out button and that nothing is stored. The forms are:
  - the admin sign-in;
  - inviting;
  - changing cases;
  - the confirm-twice buttons;
  - reopening;
  - the Continue page;
  - the welcome page;
  - the training checkbox;
  - the case form and its gap box.
- **Scenarios** (`test/scenarios.test.mjs`) act out real situations from start to finish in a real browser (Chromium), clicking and typing as a person would. Each one plays the owner, one or more labelers, or both:
  1. An invited clinician's first visit, from your invite to the downloaded file, with the activity log in order.
  2. A documentation request, with the gap typed just before leaving the case.
  3. Coming back later, in the same browser and on another device.
  4. Two labelers on the same case, never seeing each other's answers, each credited separately.
  5. Only assigned cases, even when someone types another case's address.
  6. You change someone's cases; a case with saved answers stays.
  7. A lost link replaced: the old one stops at once, and saved answers stay.
  8. A link turned off while someone is labeling, then turned back on.
  9. A submitted case reopened with a reason, fixed, and submitted again.
  10. A person removed on request: their labels and details go, and the log keeps only what happened.
  11. Two people on one shared computer.
  12. Losing the internet while labeling: nothing is lost, Submit waits, and closing the tab warns.
  13. The same case open in two tabs.
  14. The cases updated while a page is open.
  15. The whole path on a phone.
  16. A whole case with the keyboard only.
  17. Wrong addresses and wrong keys, and Sign out.
  18. Names with accents, apostrophes, and symbols.
  19. Closing the tab a moment after typing.
  20. A site deployed without an admin key.

  Every scenario also fails if any page has a script error, or a script the site's security policy blocks.

The deploy workflow runs the API tests and the input tests again before deploying.

## Working on it

```
cd labeling-site
npm ci
npm test                      # the API tests, and the positive and negative tests of every input
npx playwright install chromium   # once, for the browser tests
npm run scenarios             # the scenarios and the form tests; SCENARIO_SHOTS=<folder> also saves screenshots
npx wrangler d1 migrations apply prior-auth-labeling --local
npx wrangler dev --local --var ADMIN_KEY:a-local-admin-key-at-least-24-chars
```

Playwright is pinned to 1.56.1, which drives Chromium build 1194. `CHROMIUM_PATH=<file>` points the scenarios at another copy of Chromium.

`src/content.generated.js` is made by `build_content.py` (run by `bash eval/tools/rebuild_golden.sh`) from:
- the cases;
- the criteria and the policy text;
- the training page;
- `pages/*.html`.

It also holds each page's script fingerprint, which the security policy allows. Never edit it by hand. The "Validate golden set" workflow fails if it is out of date, and so does the deploy.

## Cost

Nothing at this size: Cloudflare's free plan includes 100,000 database writes and 5 million reads a day, and 5 GB of storage.
