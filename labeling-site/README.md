# The online labeling site

A small website for **outside labelers**: a clinician or utilization review nurse you invite to label some cases independently. It runs on Cloudflare's free plan as one Worker (a program that answers web requests) with one D1 database (Cloudflare's small SQL database). Decided in docs/ARCHITECTURE.md, ADR-13.

Your own blind labels don't go through this site. They stay on `eval/labeling/labeling.html` and the blind-labels pull request, where the checks lock them after merge.

## What a labeler sees

1. **Their personal link.** You send it yourself. Opening it signs them in on that browser for 60 days, and the link disappears from the address bar.
2. **A welcome page.** They enter the name and role they want to be credited by, and tick two boxes:
   - they agree that name and role may appear in the datasheet, next to their labels;
   - they'll label on their own: no AI tools on the cases, no searching for how to label a case, no discussing a case until it's submitted.
3. **Their home page.** It explains what labeling is and links to the optional training (`eval/labeling/training.html`, served as it is, with the guided walkthrough). A box lets them say they've done the training. It lists **only the cases you assigned them**, with each one's status.
4. **The labeling view.** The same record viewer and form as the labeling page, plus the "Policy and criteria" panel. Every change saves automatically. **Submit** locks the case.

A labeler never sees anyone else's labels. The site never holds your labels, Gemini's, or the locked intended answers. The practice cases' worked answers appear only inside the training, as in the repository.

## What you see (the admin page, `/admin`)

Sign in with the admin key (the value of the release environment's `LABELING_ADMIN_KEY`). It's kept in that browser tab only, and forgotten when the tab closes. From the admin page you can:

- **Invite a labeler.** Give their name and, optionally, an email and a note for your records, and choose cases. You get their personal link once: copy it and send it to them.
- **See each labeler's progress.** Whether they agreed, how they asked to be credited, whether they said they did the training, and each case's status (not started, started, ready to submit, or submitted, with the time).
- **Change their cases.** A case with a saved label stays assigned.
- **Make a new link** (the old one stops working at once), or **turn a link off.**
- **Reopen a submitted case,** with a reason. The reason goes into the activity log.
- **Download submitted labels.** One JSON file holds every submitted label, with who labeled it, their credit name and role, when they agreed and submitted, and a fingerprint of the case content they saw.
- **Activity.** The audit trail: invites, sign-ins, consent, first saves, submits, reopenings, link changes.

## Identity, and what the database keeps

- **Identity is the personal link.** The link holds a random 256-bit token. The database stores only its SHA-256 fingerprint, so even a copy of the database can't be used to sign in. Anyone holding a link is recorded as that person, so send each link only to its person. If a link might have been forwarded, make a new one.
- **For each labeler:** the name you typed, the optional email and note, the credit name and role they entered, when they agreed, and when they said they did the training.
- **For each label:** the answers (statuses, evidence ids, routing, gap), when it was last saved and submitted, and the fingerprint of the case content. Evidence must be ids in that case, and only approve, request, and route are accepted.
- **Not kept by the site:** IP addresses, browser details, or anything about a visit beyond the events listed above. Cloudflare keeps its usual traffic statistics for your account. The cases are synthetic; no real patient is in them.
- **Security:** pages send strict security headers (no framing, no referrer, no caching, scripts only from the page itself). Every change must carry a header that only the site's own pages send, so another site can't submit on a labeler's behalf.

## Deploying it (you, once)

You need four things in the GitHub **release** environment. The first two are the same ones the week 3 deployment uses.

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token from the **Edit Cloudflare Workers** template, with **Account, D1, Edit** added |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |
| `LABELING_ADMIN_KEY` | A long random value you make (at least 24 characters); you sign in to the admin page with it |

Your Cloudflare account also needs a **workers.dev subdomain** (Workers & Pages in the Cloudflare dashboard shows it). Then run **Actions, Deploy labeling site, Run workflow** from main and approve it. The workflow:
1. checks the content and runs the tests;
2. creates the database the first time and applies its migrations;
3. deploys;
4. sets the admin key;
5. checks the site answers.

The run's summary shows the address. Step-by-step instructions are in the project's setup guide.

**Changing the admin key:** update `LABELING_ADMIN_KEY` in the release environment and run the workflow again.

## Getting labels into the repository

Download the submitted labels from the admin page and give the file to Claude. Each person's labels become files beside the other readers' (one per case, carrying who and when), through a pull request you review. The datasheet records how outside labels were collected and who gave them.

## Removing someone's details

If a labeler asks to be removed, turn their link off on the admin page, and ask Claude to delete their rows. On your Mac, from this folder, it's this command (with their id from the admin page's activity log):

```
npx wrangler d1 execute prior-auth-labeling --remote --command "DELETE FROM labels WHERE labeler_id='lb_...'; DELETE FROM assignments WHERE labeler_id='lb_...'; DELETE FROM labelers WHERE id='lb_...';"
```

Any labels of theirs already copied into the repository are removed by a pull request, and the change is recorded in the decision log.

## Shutting it down

In the Cloudflare dashboard, delete the Worker `prior-auth-labeling`, then the D1 database `prior-auth-labeling`, after downloading anything you want to keep.

## Working on it

```
cd labeling-site
npm ci
npm test                      # local Worker and local database; nothing touches Cloudflare
npx wrangler d1 migrations apply prior-auth-labeling --local
npx wrangler dev --local --var ADMIN_KEY:a-local-admin-key-at-least-24-chars
```

`src/content.generated.js` is made by `build_content.py` (run by `bash eval/tools/rebuild_golden.sh`) from the cases, the criteria, the policy text, the training page, and `pages/*.html`. Never edit it by hand. The "Validate golden set" workflow fails if it is out of date, and so does the deploy.

## Cost

Nothing at this size: Cloudflare's free plan includes 100,000 database writes and 5 million reads a day, and 5 GB of storage.
