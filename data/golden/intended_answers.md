# Locked intended answers

`intended_answers.yaml.enc` holds Claude's intended answers for the 12 golden cases, encrypted. Nobody can read it until the key is published.

## What it holds

For each case: the scenario in plain language, the case's role (for example held out or adversarial), the intended status and evidence for each criterion, the intended routing and, for a documentation gap, the missing item, and the C1 check under both readings (EVAL_PLAN.md, Golden set composition).

## Why it is locked

Under Amendment 2 (CHARTER.md; EVAL_PLAN.md, How the answer key is made), Claude wrote the cases and knows how each one was designed. Committing the answers in a form nobody can read, before any label exists, means they cannot be changed afterward to agree with the labels. When the key is published, anyone can open the file and compare it with the labels.

## When it was fixed

Written on 2026-10-15 together with the cases, and revised the same day after two independent reviews and after the restyle of notes 08, 10 and 12, with no status or routing changed by the restyle. It was encrypted and committed before any label existed. GitHub's record of pull request #4, merged by Enlai Weng on 2026-10-15 at 22:51 Pacific time, is the record. GitHub's servers set it, not anyone's computer clock.

## Fingerprint

sha256 of `intended_answers.yaml.enc`:

```
2c589479019153fda8ba02020da9f6ce29d982e76221143ece8dd7739ccbcae8
```

If even one byte of the file changed, this fingerprint would change.

## How it was encrypted

OpenSSL 3.0.13, AES-256-CBC, with the key stretched by PBKDF2 (SHA-256, 600,000 rounds) and a random salt:

```
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -in intended_answers.yaml -out intended_answers.yaml.enc -pass file:key.txt
```

The key is a random string of 43 characters, made by a computer. It stays outside this repository until the reveal, after Enlai Weng's blind labels and the third reader's labels are committed. Not using it before then is an honor rule (DATASHEET.md).

## How to check it after the key is published

From the repository root, on a Mac or Linux:

```
shasum -a 256 data/golden/intended_answers.yaml.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in data/golden/intended_answers.yaml.enc -out intended_answers.yaml -pass pass:THE-PUBLISHED-KEY
```

The first line must print the fingerprint above (on Linux, `sha256sum` does the same). The second writes the readable answers to `intended_answers.yaml`. Use OpenSSL 3.0 or later.
