// Test of the labeling page, eval/labeling/labeling.html: a simulated labeler fills two cases, then the test checks
// the YAML the page writes, that progress is saved in the browser, the zip download, Clear this case, and that the case data carries no
// answer-like words.
// Run from the repository root: npm ci --prefix eval/tests ; node eval/tests/test_labeling.js eval/labeling/labeling.html
// The statuses, evidence, and routings chosen below are arbitrary test inputs, picked only to exercise the page.
// They are not labels and say nothing about any case.
// First written in Claude's workspace on 2026-10-15; added to the repository with the third reader (pull request #6).
const { JSDOM } = require("jsdom");
const fs = require("fs");
const os = require("os");
const pathMod = require("path");

const page = process.argv[2] || "eval/labeling/labeling.html";
const html = fs.readFileSync(page, "utf8");
const blobs = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously", url: "https://example.test/labeling.html", pretendToBeVisual: true,
  beforeParse(win) {
    win.confirm = () => true; win.scrollTo = () => {}; win.TextEncoder = require("util").TextEncoder;
    win.URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
    win.HTMLAnchorElement.prototype.click = function () {};
  },
});
const w = dom.window, d = w.document;
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const ok = (m) => console.log("ok: " + m);

// 1. The page shows 12 cases and opens on case 01.
const nav = d.querySelectorAll("#nav button");
nav.length === 12 ? ok("12 cases in the navigation") : fail("navigation shows " + nav.length + " cases");
d.querySelector("#casecol h2").textContent === "Case 01" ? ok("opens on case 01") : fail("first case shown");

function setRadio(name, value) { const el = d.querySelector(`#formcol input[name="${name}"][value="${value}"]`); el.checked = true; el.onchange(); }
function evidenceIds(crit) { return [...d.querySelectorAll(`#formcol input[type=checkbox][data-crit="${crit}"]`)].map(e => e.value); }
function tick(crit, id) { const el = [...d.querySelectorAll(`#formcol input[type=checkbox][data-crit="${crit}"]`)].find(e => e.value === id); el.checked = true; el.onchange(); }
const CRITS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"];

// 2. First case: every criterion undeterminable, the request and patient ids as evidence on one criterion, routing route.
CRITS.forEach(k => setRadio(k, "undeterminable"));
const ids1 = evidenceIds("C2_conservative_4wk");
const claimId = ids1.find(i => i.startsWith("Claim/")), patientId = ids1.find(i => i.startsWith("Patient/"));
tick("C2_conservative_4wk", patientId);   // ticked out of order on purpose: the page must sort to page order
tick("C2_conservative_4wk", claimId);
setRadio("routing", "route");
const pre = d.querySelector("#formcol pre").textContent;
/case_id: case_01/.test(pre) ? ok("case id") : fail("case id");
pre.includes(`C2_conservative_4wk:     {status: undeterminable, evidence: [${claimId}, ${patientId}]}`)
  ? ok("evidence written in page order") : fail("C2 line: " + pre);
/expected_routing: route/.test(pre) && /named_gap: null/.test(pre) ? ok("routing and empty gap") : fail("routing line");
/^labeled_on: \d{4}-\d{2}-\d{2}$/m.test(pre) ? ok("labeled_on date") : fail("labeled_on");
d.querySelector("#nav button").className.includes("done") ? ok("first case marked complete") : fail("complete mark");

// 3. Third case: every criterion unsupported and a request whose gap text holds a quote and a colon.
d.querySelector("#next").onclick(); d.querySelector("#next").onclick();
d.querySelector("#casecol h2").textContent === "Case 03" ? ok("next goes to the third case") : fail("next button");
CRITS.forEach(k => setRadio(k, "unsupported"));
setRadio("routing", "request");
let pre3 = d.querySelector("#formcol pre").textContent;
!d.querySelectorAll("#nav button")[2].className.includes("done") ? ok("a request without its gap is not complete") : fail("incomplete request marked done");
const gc = d.getElementById("gapc"); gc.value = "C4"; gc.onchange();
const gm = d.getElementById("gapm"); gm.value = 'test text: "quoted" and a colon'; gm.onchange();
pre3 = d.querySelector("#formcol pre").textContent;
pre3.includes('named_gap: {criterion: C4, missing: "test text: \\"quoted\\" and a colon"}') ? ok("gap text quoted safely") : fail("gap line: " + pre3);

// 4. Progress is saved in the browser.
const saved = w.localStorage.getItem("golden-set-labels-v1");
saved && JSON.parse(saved).case_03.routing === "request" ? ok("progress saved in browser storage") : fail("browser storage");

// 5. The zip holds 12 files at the right paths.
d.getElementById("zip").onclick();
const fr = new w.FileReader();
fr.onload = () => {
  const b = Buffer.from(new Uint8Array(fr.result));
  const out = pathMod.join(os.tmpdir(), "labels_blind_test.zip");
  fs.writeFileSync(out, b);
  const names = [];
  for (let i = 0; i + 30 < b.length; i++) {
    if (b.readUInt32LE(i) === 0x04034b50) { const n = b.readUInt16LE(i + 26); names.push(b.slice(i + 30, i + 30 + n).toString()); }
  }
  const good = names.length === 12 && names.every(n => /^data\/golden\/case_\d\d\/labels_blind\.yaml$/.test(n));
  good ? ok("zip has 12 labels_blind.yaml files at their case paths (" + out + ")") : fail("zip contents: " + names.join(", "));
};
fr.readAsArrayBuffer(blobs[0]);

// 6. The case data on the page carries no answer-like wording.
const leak = /(expected_routing:\s*(approve|request|route)|held[- ]out|red flag:|adversarial|intended answer)/i;
const data = html.slice(html.indexOf("const CASES"), html.indexOf("const POLICY_HEAD"));
leak.test(data) ? fail("answer-like wording in the case data: " + data.match(leak)[0]) : ok("no answer-like wording in the case data");

// 7. Clear this case (case 03 is open). Cancelled: nothing changes. Confirmed: only this case is emptied.
d.querySelector("#casecol h2").textContent === "Case 03" ? ok("still on the third case") : fail("expected case 03");
const stored = () => JSON.parse(w.localStorage.getItem("golden-set-labels-v1"));
w.confirm = () => false; d.getElementById("clearcase").onclick();
stored().case_03.routing === "request" && d.querySelectorAll("#nav button")[2].className.includes("done")
  ? ok("negative: cancelling Clear keeps the case's answers") : fail("cancelling Clear changed the case");
w.confirm = () => true; d.getElementById("clearcase").onclick();
const c3 = stored().case_03;
!c3 || (c3.routing === "" && CRITS.every(k => !c3.criteria[k].status && !c3.criteria[k].evidence.length))
  ? ok("positive: Clear empties this case's answers") : fail("case 03 after Clear: " + JSON.stringify(c3));
stored().case_01 && stored().case_01.routing === "route" && stored().case_01.criteria.C2_conservative_4wk.evidence.length === 2
  ? ok("positive: Clear keeps every other case") : fail("Clear changed case 01");
const marks = [...d.querySelectorAll("#nav button")].map(b => b.className.includes("done"));
marks[0] && !marks[2] ? ok("positive: the check marks follow (case 01 kept, case 03 cleared)") : fail("check marks after Clear: " + marks);
const pre7 = d.querySelector("#formcol pre").textContent;
/C1_red_flag:\s+\{status: , evidence: \[\]\}/.test(pre7) && /named_gap: null/.test(pre7)
  ? ok("positive: the preview shows case 03 empty") : fail("preview after Clear: " + pre7);
CRITS.every(k => !d.querySelector(`#formcol input[name="${k}"]:checked`)) ? ok("positive: the form shows no answers") : fail("form still shows answers");
setRadio("C1_red_flag", "supported");
stored().case_03.criteria.C1_red_flag.status === "supported" ? ok("positive: a cleared case can be labeled again") : fail("relabeling after Clear");
