// Tests of the agent's input step (agent/record.js) against the Python that builds the case pages, on every bundle in
// the repository. The agent must number note paragraphs exactly as the labels do (ADR-10 (2)).
// Run from the repository root: node --test 'agent/test/*.test.js'   (needs python3 on the path)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readCase, caseMessage, noteParagraphs } from "../record.js";

const dirs = ["data/smoke/case_00", ...readdirSync("data/golden").filter(d => /^case_\d\d/.test(d)).sort().map(d => `data/golden/${d}`)];

// What build_case_pages.py sees for each case: the note's paragraphs and every id a label may cite.
const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "eval/tools")
from build_case_pages import case_view
out = {}
for d in json.loads(sys.argv[1]):
    v = case_view(d)
    ids = [v["request"]["id"], v["patient"]["id"], v["note"]["id"]] + [i["id"] for s in v["sections"] for i in s["items"]]
    out[d] = {"paragraphs": [p["text"] for p in v["note"]["paragraphs"]], "ids": ids + [p["id"] for p in v["note"]["paragraphs"]]}
print(json.dumps(out))
`, JSON.stringify(dirs)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

test("covers the smoke case, the twelve golden cases, and the two pairs", () => {
  assert.equal(dirs.length, 15);
});

for (const d of dirs) {
  test(`${d}: same note paragraphs as the case pages, and every label id is citable`, () => {
    const rc = readCase(JSON.parse(readFileSync(`${d}/bundle.json`, "utf8")));
    assert.deepEqual(rc.paragraphs.map(p => p.text), py[d].paragraphs);
    assert.deepEqual(rc.paragraphs.map(p => p.id), py[d].paragraphs.map((_, i) => `note:p${i + 1}`));
    const citable = new Set(rc.citableIds);
    for (const id of py[d].ids) assert.ok(citable.has(id), `${id} missing`);
  });
}

test("the message carries the note as numbered paragraphs, not as encoded text", () => {
  const bundle = JSON.parse(readFileSync("data/smoke/case_00/bundle.json", "utf8"));
  const doc = bundle.entry.map(e => e.resource).find(r => r.resourceType === "DocumentReference");
  const msg = caseMessage(readCase(bundle));
  assert.ok(!msg.includes(doc.content[0].attachment.data), "encoded note text still in the message");
  assert.ok(msg.includes("[note:p1] Provider visit note goes here."));
  assert.ok(msg.includes("Claim/case00-claim"));
  assert.ok(msg.includes('"birthDate"'), "the rest of the record is sent unchanged");
  assert.ok(msg.includes("us-core-race"), "demographics are sent, so the fairness pairs test what they should");
});

test("paragraph splitting matches the Python rule on edge cases", () => {
  assert.deepEqual(noteParagraphs("\n\n A \n\n\n\nB\n  \nC\nD \n"), ["A", "B", "C\nD"]);
  assert.deepEqual(noteParagraphs("one paragraph only"), ["one paragraph only"]);
});

test("a bundle without exactly one Claim is refused", () => {
  const bundle = JSON.parse(readFileSync("data/smoke/case_00/bundle.json", "utf8"));
  bundle.entry = bundle.entry.filter(e => e.resource.resourceType !== "Claim");
  assert.throws(() => readCase(bundle), /exactly one Claim/);
});
