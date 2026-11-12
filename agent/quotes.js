// The agent's own check of its policy quotes (docs/ARCHITECTURE.md, ADR-10: the model reports, code checks).
// The instructions ask for the policy's words copied exactly. The model usually does that, and now and then adds or
// drops a small word at an end ("the MRI will be covered" for the policy's "MRI will be covered"). A reviewer should
// only ever be shown text that is in the policy, so every quote is checked here before the decision is written.
//
// A quote counts as word for word when, with runs of spaces and line breaks treated as one space, it appears inside
// one of the passages its criterion cites, and it is at least three words long or is a whole passage (some passages
// are one word, such as "Fever"). This is the same test eval/score.py applies, written separately; the tests hold
// the two to the same answers.
//
// When a quote is not word for word, the check keeps the longest run of the quote's own consecutive words that is
// word for word in one cited passage, if that run keeps at least four fifths of the words the model wrote and is at
// least three words long. What the model wrote is kept in the decision beside it. Words are only ever dropped from
// the ends: nothing is added, reordered, or reworded, and a quote that needs more than that is left exactly as
// written and listed as not verified. A quote joined from separate phrases, or reworded in the middle, stays that
// way, because no single run keeps four fifths of it.
// Pure functions; no case-specific logic.

export const MIN_WORDS = 3;
export const KEEP_SHARE = 0.8;

// Runs of whitespace as one space, ends trimmed. The characters are the ones Python counts as whitespace (its \s
// and str.split()), listed out so this file and eval/score.py treat every quote alike: JavaScript's own \s differs
// from Python's by a few rare characters.
const SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACES = new RegExp(`[${SPACE}]+`, "g"), ENDS = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "g");
export function norm(s) {
  return String(s).replace(SPACES, " ").replace(ENDS, "");
}

const stripEnd = s => s.replace(/[.,;:]+$/, "");

// Whether a quote is word for word in one of the passage texts given.
export function wordForWord(quote, texts) {
  const q = norm(quote);
  const passages = texts.map(norm);
  if (!q || !passages.some(t => t.includes(q))) return false;
  return q.split(" ").length >= MIN_WORDS || passages.some(t => stripEnd(q) === stripEnd(t));
}

// The longest run of the quote's consecutive words that appears in one passage, as { text, words }, or null.
export function longestRun(quote, texts) {
  const words = norm(quote).split(" ").filter(Boolean);
  const passages = texts.map(norm);
  let best = null;
  for (let i = 0; i < words.length; i++) {
    for (let j = words.length; j > i; j--) {
      if (best && j - i <= best.words) break;   // nothing from this start can be longer than the best so far
      const run = words.slice(i, j).join(" ");
      if (passages.some(t => t.includes(run))) { best = { text: run, words: j - i }; break; }
    }
  }
  return best;
}

// Check one quote against the texts of the passages its criterion cites.
// Returns { quote, verified, as_written }: as_written is the model's own text when the quote was trimmed, else null.
export function checkQuote(quote, texts) {
  if (wordForWord(quote, texts)) return { quote, verified: true, as_written: null };
  const total = norm(quote).split(" ").filter(Boolean).length;
  const run = total ? longestRun(quote, texts) : null;
  if (run && run.words >= MIN_WORDS && run.words >= KEEP_SHARE * total && wordForWord(run.text, texts)) {
    return { quote: run.text, verified: true, as_written: quote };
  }
  return { quote, verified: false, as_written: null };
}

// Check every criterion's quote in a report. passages maps a passage id to its text.
// Returns { criteria, trimmed, unverified }: criteria is a copy of the report's with any trimmed quote in place;
// trimmed lists { criterion, as_written }; unverified lists the criteria whose quote is still not word for word.
export function checkQuotes(report, passages, shortNames) {
  const criteria = {}, trimmed = [], unverified = [];
  for (const [key, c] of Object.entries(report.criteria)) {
    const texts = c.policy_passages.filter(id => Object.hasOwn(passages, id)).map(id => passages[id]);
    const r = checkQuote(c.policy_quote, texts);
    criteria[key] = r.as_written === null ? c : { ...c, policy_quote: r.quote };
    if (r.as_written !== null) trimmed.push({ criterion: shortNames[key] || key, as_written: r.as_written });
    if (!r.verified) unverified.push(shortNames[key] || key);
  }
  return { criteria, trimmed, unverified };
}
