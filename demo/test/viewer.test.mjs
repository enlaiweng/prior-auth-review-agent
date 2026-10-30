// The viewer in a real browser (Chromium through Playwright), against the real Worker and a fake model.
//   CHROMIUM_PATH=<file>  uses that Chromium instead of the one `npx playwright install chromium` downloads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build, startFakeModel, startDemo, PASSCODE, finalLabels, reportFrom } from "./local-demo.mjs";

let browser, fake, demo, errors = [];
before(async () => {
  build();
  fake = await startFakeModel();
  fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
  demo = await startDemo({ AGENT_TEST_API_URL: fake.url });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); demo?.stop(); fake?.stop(); });

async function open(path = "/", viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(demo.base + path);
  await page.waitForSelector(".cases button");
  await page.waitForSelector("#main h2");
  return { ctx, page };
}

test("the page lists the twelve cases, says checklist mode, and opens case 01 with its record", async () => {
  errors = [];
  const { ctx, page } = await open();
  assert.equal(await page.locator(".cases button").count(), 12);
  assert.match(await page.locator("#mode").innerText(), /Checklist mode: approvals and document requests are switched off/);
  assert.equal(await page.locator("#main h2").innerText(), "Case 01");
  assert.match(await page.locator("#main").innerText(), /No stored decision yet/);
  assert.ok(await page.locator("#rec-Claim_case01-claim").count(), "the record lists the request with its id");
  assert.ok(await page.locator("#rec-note_p1").count(), "and the note's paragraphs");
  assert.match(await page.locator("footer").innerText(), /agent-\d/);
  assert.deepEqual(errors, [], "no script errors and nothing blocked by the page's security policy");
  await ctx.close();
});

test("a live run: the passcode, the result in plain words, and evidence that jumps to the record", async () => {
  errors = [];
  const { ctx, page } = await open("/#case_01");
  await page.click("#run");
  assert.match(await page.locator("#livestate").innerText(), /Type the passcode first/);
  await page.fill("#pc", "wrong-passcode-1");
  await page.click("#run");
  await page.waitForFunction(() => /isn't right/.test(document.getElementById("livestate").innerText));
  await page.fill("#pc", PASSCODE);
  await page.press("#pc", "Enter");
  await page.waitForSelector("#liveresult .badge", { timeout: 30000 });
  const result = await page.locator("#liveresult").innerText();
  assert.match(result, /Live run, just now/);
  assert.match(result, /Send to physician review/);
  assert.match(result, /Checklist mode is on/);
  assert.doesNotMatch(result, /\bden(y|ied|ial)\b/i, "never the word deny");
  assert.equal(await page.locator("#liveresult .crit").count(), 4);
  assert.match(await page.locator("#livestate").innerText(), /Done in \d+ s/);
  const chip = page.locator('#liveresult button[data-goto="Procedure/case01-pt-01"]');
  await chip.click();
  await page.waitForFunction(() => document.getElementById("rec-Procedure_case01-pt-01").classList.contains("hl"));
  // The browser logs the refused wrong passcode (403) as a failed request; that one is expected, nothing else is.
  assert.deepEqual(errors.filter(e => !/status of 403/.test(e)), []);
  assert.equal(errors.length, 1, "exactly the one wrong-passcode refusal");
  await ctx.close();
});

test("held-out and unsettled cases explain why they don't run live", async () => {
  const { ctx, page } = await open("/#case_10");
  assert.equal(await page.locator("#main h2").innerText(), "Case 10");
  assert.match(await page.locator("#livecard").innerText(), /held-out cases/);
  assert.equal(await page.locator("#pc").count(), 0, "no passcode box");
  await page.click('.cases button[data-case="case_05"]');
  await page.waitForFunction(() => document.querySelector("#main h2").innerText === "Case 05");
  assert.match(await page.locator("#livecard").innerText(), /isn't settled yet/);
  assert.equal(page.url().endsWith("#case_05"), true, "the address names the case, so it can be shared");
  await page.click('.cases button[data-case="case_04"]');
  await page.waitForFunction(() => document.querySelector("#main h2").innerText === "Case 04");
  assert.match(await page.locator("#livecard").innerText(), /outside clinician is reading this case/);
  await page.click('.cases button[data-case="case_06"]');
  await page.waitForFunction(() => document.querySelector("#main h2").innerText === "Case 06");
  assert.match(await page.locator("#livecard").innerText(), /Until the first full run \(run 1\)/);
  assert.equal(await page.locator("#pc").count(), 0);
  await ctx.close();
});

test("on a phone the page fits the screen with no sideways scrolling", async () => {
  const { ctx, page } = await open("/#case_02", { width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `the page is ${overflow}px wider than the screen`);
  assert.ok(await page.locator("#pc").isVisible());
  await ctx.close();
});

test("hostile text from the model is shown as text, never run or turned into markup", async () => {
  errors = [];
  const report = reportFrom(finalLabels("case_02"));
  report.criteria.C1_red_flag.explanation = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  report.criteria.C2_conservative_4wk.evidence = ['x" onmouseover="window.__pwned=3" data-x="', "note:p1"];
  report.case_summary = "</div><b id=injected>bold</b>";
  fake.reply = () => ({ report });
  const { ctx, page } = await open("/#case_02");
  await page.fill("#pc", PASSCODE);
  await page.click("#run");
  await page.waitForSelector("#liveresult .badge", { timeout: 30000 });
  await page.hover("#liveresult button.id >> nth=0");
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "nothing in the model's text ran");
  assert.equal(await page.locator("#liveresult img").count(), 0);
  assert.equal(await page.locator("#injected").count(), 0);
  assert.match(await page.locator("#liveresult").innerText(), /<img src=x onerror=/, "the text is shown as written");
  assert.deepEqual(errors, []);
  fake.reply = () => ({ report: reportFrom(finalLabels("case_01")) });
  await ctx.close();
});
