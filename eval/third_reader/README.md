# Third reader

A model from another company labels the same twelve case pages the owner labels, so the comparison can show where a case reads two ways (docs/EVAL_PLAN.md, How the answer key is made). The reader is Gemini, through the Gemini API.

## What is here

| Path | What it is | Made by |
|---|---|---|
| `prompt_template.md` | The instructions, with markers for the policy, criteria, outcomes, and case page | Written by Claude before labeling |
| `prompts/case_NN.txt` | The exact prompt for each case | `eval/tools/build_third_reader_prompts.py` |
| `prompts/prompts.sha256` | One fingerprint per prompt, fixed before labeling | The same script |
| `run_third_reader.py` | Sends each prompt to Gemini and saves the replies and labels | Written by Claude |
| `runs/RUN/` | One folder per workflow run: each reply exactly as Gemini sent it (`case_NN.response.json`) and `run_record.json` | `run_third_reader.py`, in the workflow |
| `../../data/golden/case_NN/labels_gemini.yaml` | Gemini's labels, in the labels template's format | `run_third_reader.py` |

## How a run goes

1. The owner's blind labels for all twelve cases are merged on main. Until then the workflow refuses to start.
2. The owner starts **Third reader (Gemini)** from the Actions tab and approves it (it uses the "release" environment, where the key is).
3. The workflow checks every prompt against its fingerprint and that the prompts still match the bundles, then sends them one at a time.
4. For each reply it saves the whole reply, reads the YAML in it, and checks its form with `eval/tools/check_labels.py`. A reply that passes becomes `labels_gemini.yaml`. A reply that does not is kept and listed as failed, and no labels file is made from it.
5. The results arrive as a pull request. Claude adds the reveal and the disagreement report to that pull request before the owner merges it.

## Settings

| Setting | Value | Why |
|---|---|---|
| Model | `gemini-3.8-flash` | The newest stable model on Gemini's free tier, which the key was set up on (checked on Google's models and pricing pages, 2026-10-16). The larger models (Gemini 4 Argon, Gemini 3.1 Pro) have no free tier. |
| What is sent | The prompt, as the only content of one message | The prompt was fixed before labeling. Nothing else is added. |
| Other settings | None, so the model's own defaults for temperature and thinking | Fewer choices made by the project, and none tuned to the cases |
| Model version | Recorded per case, as Gemini reports it in each reply (`modelVersion`) | EVAL_PLAN.md requires it |
| Retries | Up to five attempts, only on a rate limit or a server error | A rate limit says nothing about the case |
| Reruns | A case whose reply failed the form check can be sent again by entering its number when starting the workflow. A case that already has labels is never sent again. | Gemini's labels, like the owner's, are never edited; every run keeps its own folder |

Google's free tier may use what is sent through it to improve its products. Every patient here is synthetic and the policy text is public.

## Tests

`eval/tests/test_third_reader.py` runs the script against a fake Gemini server on the test computer and checks the retries, the fence handling, the form check, that the key goes in a header and never in the address, and that existing labels are never overwritten. The Checks workflow runs it on every pull request.
