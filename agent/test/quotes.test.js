// Tests of the agent's check of its policy quotes (agent/quotes.js), and of the check inside the agent module.
// The check must agree with the scorer (eval/score.py) on which quotes are word for word, on every example here, so
// "the agent verified it" and "the scorer counts it" mean the same thing.
// Run from the repository root: node --test 'agent/test/*.test.js'   (needs python3 on the path)
// The quotes below are pieces of the policy text and made-up variations of them. The last tests run the agent module
// on the throwaway test case (data/smoke/case_00) with a made-up report. No golden case is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { norm, wordForWord, checkQuote, checkQuotes, MIN_WORDS } from "../quotes.js";
import { reviewCase } from "../agent.js";
import { PASSAGES, PASSAGE_IDS } from "../spec.generated.js";

const P36 = PASSAGES["L34220-36"];
const EXACT = "MRI will be covered only if the patient has not responded to a reasonable trial of conservative management lasting at least four weeks";

test("the passage texts the agent checks against are the policy file's, id for id", () => {
  const file = JSON.parse(readFileSync("data/policy/passages.json", "utf8")).passages;
  assert.deepEqual(Object.keys(PASSAGES), PASSAGE_IDS);
  assert.deepEqual(Object.keys(PASSAGES), file.map(p => p.id));
  for (const p of file) assert.equal(PASSAGES[p.id], p.text, p.id);
  assert.ok(P36.includes(EXACT), "the example used below is in the policy");
});

test("word for word: inside one cited passage, spaces and line breaks as one space, three words or a whole passage", () => {
  assert.equal(wordForWord(EXACT, [P36]), true);
  assert.equal(wordForWord("  MRI will be\n covered   only if ", [P36]), true);
  assert.equal(wordForWord("the " + EXACT, [P36]), false, "an added word");
  assert.equal(wordForWord(EXACT.replace("four weeks", "4 weeks"), [P36]), false, "a reworded word");
  assert.equal(wordForWord("MRI will be covered ... lasting at least four weeks", [P36]), false, "phrases joined with an ellipsis");
  assert.equal(wordForWord(EXACT, [PASSAGES["L34220-37"]]), false, "the right words under the wrong passage");
  assert.equal(wordForWord(EXACT, []), false);
  assert.equal(wordForWord("", [P36]), false);
  assert.equal(wordForWord("will be", [P36]), false, "two words are a fragment");
  assert.equal(wordForWord("will be covered", [P36]), true);
  assert.equal(MIN_WORDS, 3);
  // A passage of one or two words may be quoted whole.
  const short = Object.entries(PASSAGES).filter(([, t]) => norm(t).split(" ").length < 3);
  assert.ok(short.length > 0, "the policy has passages shorter than three words");
  for (const [id, t] of short) {
    assert.equal(wordForWord(t, [t]), true, id);
    assert.equal(wordForWord(t.replace(/[.,;:]+$/, ""), [t]), true, id + " without its closing punctuation");
  }
});

test("a wrong first or last word is dropped and the model's own text kept; anything more is left as written", () => {
  const trimmed = q => ({ quote: EXACT, verified: true, as_written: q });
  const untouched = q => ({ quote: q, verified: false, as_written: null });
  assert.deepEqual(checkQuote(EXACT, [P36]), { quote: EXACT, verified: true, as_written: null });
  // One word too many at the start, at the end, or both.
  for (const q of ["the " + EXACT, EXACT + " also", "the " + EXACT + " also"]) assert.deepEqual(checkQuote(q, [P36]), trimmed(q), q);
  // A first word that differs from the policy's only in its capital letter or quotation mark is still a wrong word:
  // it is dropped, never corrected.
  const p16 = PASSAGES["L34220-16"], w16 = norm(p16).split(" ");
  const said = ["red", ...w16.slice(1, 9)].join(" ");
  assert.deepEqual(checkQuote(said, [p16]), { quote: w16.slice(1, 9).join(" "), verified: true, as_written: said });
  // Two words too many at one end, a wrong word further in, a changed number near the end, phrases joined with an
  // ellipsis (a long piece and a short one too), the wrong passage, text that is not policy, an empty quote: not
  // verified, and not touched.
  for (const q of ["then the " + EXACT, EXACT + " or more",
                   EXACT.replace("reasonable trial", "fair trial"), EXACT.replace("will be covered", "will not be covered"),
                   EXACT.replace("four weeks", "six weeks"),
                   "MRI will be covered ... conservative management lasting at least four weeks", EXACT + " ... red flags",
                   "Imaging is always covered for this patient", ""]) {
    assert.deepEqual(checkQuote(q, [P36]), untouched(q), q);
  }
  assert.deepEqual(checkQuote(EXACT, [PASSAGES["L34220-37"]]), untouched(EXACT));
  assert.deepEqual(checkQuote("the " + EXACT, []), untouched("the " + EXACT));
  // What is left after dropping is never shorter than three words.
  const text = ["one two three four five six seven eight nine ten"];
  assert.equal(checkQuote("zero one two three", text).quote, "one two three");
  assert.equal(checkQuote("zero one two", text).verified, false);
  assert.equal(checkQuote("zero one two three eleven", text).quote, "one two three");
  assert.equal(checkQuote("zero one two eleven", text).verified, false);
  // The fewest words are dropped: the first word alone before the last alone, either alone before both.
  assert.equal(checkQuote("zero two three four", ["zero two three", "two three four"]).quote, "two three four");
  assert.equal(checkQuote("one two three four ten", text).quote, "one two three four");
  // A quote the model wrapped in quotation marks loses its first and last words, which carry the marks.
  assert.equal(checkQuote('"two three four five six"', text).quote, "three four five");
  // A very long quote is checked quickly: three tries, however long it is.
  const long = Array.from({ length: 20000 }, (_, i) => "w" + i).join(" ");
  const started = Date.now();
  assert.equal(checkQuote(long, [P36]).verified, false);
  assert.ok(Date.now() - started < 1000);
});

test("whatever the check calls verified, the scorer counts, on the policy's own text and on variations of it", () => {
  // Examples: for every passage, the whole text, its first and last words, a middle run, and each of those with a
  // word added in front, a word added behind, a word changed, and two pieces joined. Each is checked against the
  // passage itself and against its neighbor.
  const ids = PASSAGE_IDS, examples = [];
  ids.forEach((id, n) => {
    const w = norm(PASSAGES[id]).split(" ");
    const pieces = [PASSAGES[id], w.slice(0, 6).join(" "), w.slice(-6).join(" "), w.slice(2, 12).join(" "), w.slice(0, 2).join(" "), w[0]];
    const other = ids[(n + 1) % ids.length];
    for (const piece of pieces) {
      const changed = piece.split(" "); changed[Math.floor(changed.length / 2)] = "changed";
      for (const q of [piece, "the " + piece, piece + " also", "the " + piece + " also", "then the " + piece, changed.join(" "),
                       piece + " ... " + w.slice(-3).join(" "), piece.replace(/ /g, "\u00a0\n")]) {
        examples.push({ quote: q, cited: [id] }, { quote: q, cited: [other] }, { quote: q, cited: [other, id] });
      }
    }
  });
  const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "eval")
import score
passages = score.passage_texts()
print(json.dumps([score.quote_faithful(e["quote"], e["cited"], passages) for e in json.load(sys.stdin)]))
`], { input: JSON.stringify(examples), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  assert.equal(py.length, examples.length);
  assert.ok(examples.length > 6000);
  let verified = 0, trimmed = 0;
  examples.forEach((e, i) => {
    const texts = e.cited.map(id => PASSAGES[id]);
    assert.equal(wordForWord(e.quote, texts), py[i], `the agent and the scorer differ on ${JSON.stringify(e)}`);
    const r = checkQuote(e.quote, texts);
    if (r.verified) verified++;
    if (r.as_written !== null) {
      trimmed++;
      assert.equal(r.as_written, e.quote);
      const said = norm(e.quote).split(" "), kept = r.quote.split(" ");
      assert.ok(norm(e.quote).includes(r.quote), "a trimmed quote is a piece of what was written");
      assert.ok(said.length - kept.length <= 2 && kept.length >= 3, "at most one word from each end, and three words left");
    }
    else assert.equal(r.quote, e.quote, "a quote that is not trimmed is not touched");
    assert.equal(r.verified, r.as_written !== null || py[i], JSON.stringify(e));
  });
  // The trimmed quotes go back through the scorer: each one must count.
  const again = examples.map((e, i) => ({ e, r: checkQuote(e.quote, e.cited.map(id => PASSAGES[id])) })).filter(x => x.r.as_written !== null);
  const pyAgain = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "eval")
import score
passages = score.passage_texts()
print(json.dumps([score.quote_faithful(e["quote"], e["cited"], passages) for e in json.load(sys.stdin)]))
`], { input: JSON.stringify(again.map(x => ({ quote: x.r.quote, cited: x.e.cited }))), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  assert.ok(trimmed > 100 && verified > trimmed);
  assert.ok(pyAgain.every(Boolean), "every trimmed quote is word for word by the scorer's test");
});

// ---- Inside the agent module ---------------------------------------------------------------------------------------

const smoke = JSON.parse(readFileSync("data/smoke/case_00/bundle.json", "utf8"));
const crit = (status, evidence, passages, quote) => ({ explanation: "e", evidence, policy_passages: passages, policy_quote: quote, status });
const reportWith = quotes => ({
  criteria: {
    C1_red_flag: crit("unsupported", [], ["L34220-17"], quotes.C1),
    C2_conservative_4wk: crit("supported", ["Procedure/case00-pt-01", "MedicationRequest/case00-med-01"], ["L34220-35", "L34220-36"], quotes.C2),
    C3_informs_management: crit("undeterminable", [], ["L34220-39"], quotes.C3),
    C4_no_duplicate_imaging: crit("supported", [], ["L34220-41", "L34220-99"], quotes.C4),
  },
  contradictions: [], missing_document: { criterion: "C3", missing: "a made-up document, for this test" },
  case_summary: "s", confidence: "moderate",
});
const reply = report => async () => ({ ok: true, status: 200, headers: { get: () => "req_test" }, text: async () => JSON.stringify({
  model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(report) }],
  usage: { input_tokens: 1, output_tokens: 1 } }) });
const C1 = norm(PASSAGES["L34220-17"]), C3 = norm(PASSAGES["L34220-39"]).split(" ").slice(0, 8).join(" "), C4 = norm(PASSAGES["L34220-41"]);

test("the agent trims a stray word, keeps what the model wrote, and decides the same either way", async () => {
  const exact = await reviewCase(smoke, { apiKey: "k", caseId: "case_00", fetchImpl: reply(reportWith({ C1, C2: EXACT, C3, C4 })) });
  assert.deepEqual(exact.policy_quotes_trimmed, []);
  assert.deepEqual(exact.policy_quotes_unverified, []);
  assert.equal(exact.criteria.C2_conservative_4wk.policy_quote, EXACT);

  const stray = await reviewCase(smoke, { apiKey: "k", caseId: "case_00", fetchImpl: reply(reportWith({ C1, C2: "the " + EXACT, C3, C4 })) });
  assert.equal(stray.criteria.C2_conservative_4wk.policy_quote, EXACT);
  assert.deepEqual(stray.policy_quotes_trimmed, [{ criterion: "C2", as_written: "the " + EXACT }]);
  assert.deepEqual(stray.policy_quotes_unverified, []);
  // Nothing but the quote differs between the two decisions.
  const rest = d => JSON.stringify({ ...d, seconds: 0, policy_quotes_trimmed: null });
  assert.equal(rest(stray), rest(exact));
  assert.equal(stray.routing, "request");
});

test("a quote that needs more than trimming is left as the model wrote it and listed as not verified", async () => {
  const joined = "MRI will be covered ... conservative management lasting at least four weeks";
  const d = await reviewCase(smoke, { apiKey: "k", caseId: "case_00", fetchImpl: reply(reportWith({ C1: "", C2: joined, C3: "not in the policy at all", C4 })) });
  assert.equal(d.criteria.C1_red_flag.policy_quote, "");
  assert.equal(d.criteria.C2_conservative_4wk.policy_quote, joined);
  assert.equal(d.criteria.C3_informs_management.policy_quote, "not in the policy at all");
  assert.deepEqual(d.policy_quotes_trimmed, []);
  assert.deepEqual(d.policy_quotes_unverified, ["C1", "C2", "C3"]);
  // The outcome does not depend on the quotes: the rule reads statuses, evidence, and passage ids.
  assert.equal(d.routing, "request");
  assert.deepEqual(d.invalid_policy_passages, ["L34220-99"], "a passage id that does not exist is still reported, and its text is simply not there to check against");
});

test("a decision that failed has no quotes to check", async () => {
  const bad = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>gateway</html>" });
  const d = await reviewCase(smoke, { apiKey: "k", fetchImpl: bad, sleep: async () => {} });
  assert.equal(d.routing, "route");
  assert.deepEqual(d.policy_quotes_trimmed, []);
  assert.deepEqual(d.policy_quotes_unverified, []);
});

test("a reply with something extra under criteria still gets a decision", async () => {
  const report = reportWith({ C1, C2: "the " + EXACT, C3, C4 });
  report.criteria.C5_made_up = null;
  report.criteria.note = "extra";
  const d = await reviewCase(smoke, { apiKey: "k", caseId: "case_00", fetchImpl: reply(report) });
  assert.equal(d.error, null);
  assert.equal(d.routing, "request");
  assert.deepEqual(d.policy_quotes_trimmed, [{ criterion: "C2", as_written: "the " + EXACT }]);
  assert.deepEqual(d.policy_quotes_unverified, []);
  assert.equal(d.criteria.C5_made_up, null);
});

test("checkQuotes copies the criteria and never changes the report it was given", () => {
  const report = reportWith({ C1, C2: "the " + EXACT, C3, C4 });
  const before = JSON.stringify(report);
  const short = { C1_red_flag: "C1", C2_conservative_4wk: "C2", C3_informs_management: "C3", C4_no_duplicate_imaging: "C4" };
  const out = checkQuotes(report, PASSAGES, short);
  assert.equal(JSON.stringify(report), before);
  assert.equal(out.criteria.C2_conservative_4wk.policy_quote, EXACT);
  assert.equal(out.criteria.C1_red_flag, report.criteria.C1_red_flag, "an untouched criterion is passed through as it is");
});
