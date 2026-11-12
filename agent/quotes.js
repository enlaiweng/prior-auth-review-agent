// The agent's own check of its policy quotes (docs/ARCHITECTURE.md, ADR-10: the model reports, code checks).
// The instructions ask for the policy's words copied exactly. The model usually does that, and now and then gets the
// first or last word wrong: "the MRI will be covered" for the policy's "MRI will be covered". Every quote is checked
// here before the decision is written, so the decision says which quotes are the policy's own words.
//
// A quote counts as word for word when, with runs of spaces and line breaks treated as one space, it appears inside
// one of the passages its criterion cites, and it is at least three words long or is a whole passage (some passages
// are one word, such as "Fever"). This is the same test eval/score.py applies, written separately; the tests hold
// the two to the same answers.
//
// When a quote is not word for word, the check tries dropping its first word, its last word, or both. If what is
// left is word for word and at least three words long, that replaces the quote, and what the model wrote is kept in
// the decision beside it. One word at each end is the most that is ever dropped. Nothing is added, reordered, or
// reworded. A quote that needs more than that is left exactly as written and listed as not verified: a wrong word
// further in, phrases joined with an ellipsis, a passage the criterion does not cite.
// Pure functions; no case-specific logic.

export const MIN_WORDS = 3;

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

// Check one quote against the texts of the passages its criterion cites.
// Returns { quote, verified, as_written }: as_written is the model's own text when the quote was trimmed, else null.
export function checkQuote(quote, texts) {
  if (wordForWord(quote, texts)) return { quote, verified: true, as_written: null };
  const words = norm(quote).split(" ").filter(Boolean);
  // Drop the first word, then the last, then both: the fewest words first.
  for (const [first, last] of [[1, 0], [0, 1], [1, 1]]) {
    const kept = words.slice(first, words.length - last);
    if (kept.length < MIN_WORDS) continue;
    const text = kept.join(" ");
    if (wordForWord(text, texts)) return { quote: text, verified: true, as_written: quote };
  }
  return { quote, verified: false, as_written: null };
}

// Check every criterion's quote in a report. passages maps a passage id to its text.
// Returns { criteria, trimmed, unverified }: criteria is a copy of the report's with any trimmed quote in place;
// trimmed lists { criterion, as_written }; unverified lists the criteria whose quote is still not word for word.
// The report must already have passed the agent's shape check (agent/agent.js, reportProblems).
export function checkQuotes(report, passages, shortNames) {
  const criteria = { ...report.criteria }, trimmed = [], unverified = [];
  // Only the criteria the agent knows (shortNames: the report's key to C1, C2, ...). Anything else a reply might
  // carry under criteria is passed through as it is.
  for (const [key, short] of Object.entries(shortNames)) {
    const c = report.criteria[key];
    const texts = c.policy_passages.filter(id => Object.hasOwn(passages, id)).map(id => passages[id]);
    const r = checkQuote(c.policy_quote, texts);
    if (r.as_written !== null) {
      criteria[key] = { ...c, policy_quote: r.quote };
      trimmed.push({ criterion: short, as_written: r.as_written });
    }
    if (!r.verified) unverified.push(short);
  }
  return { criteria, trimmed, unverified };
}
