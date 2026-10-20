// Scenario tests of the labeling site: real situations acted out from start to finish in a real browser (Chromium,
// driven by Playwright), against the real Worker code and an empty local database (test/local-site.mjs). Each scenario
// plays the owner, one or more labelers, or both, clicking and typing the way a person would, and checks what each of
// them sees and what the site stored. Nothing touches Cloudflare.
//
// Run from labeling-site/: npm run scenarios
//   SCENARIO_SHOTS=<folder>  also saves screenshots of key moments there.
//   CHROMIUM_PATH=<file>     uses that Chromium instead of the one `npx playwright install chromium` downloads.
//
// The answers below are made-up test inputs, picked only to exercise the site ("the first evidence box", "the last
// one"). They are not labels and say nothing about any case. Screenshots show only the practice cases and the admin page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { CONTENT } from "../src/content.generated.js";
import { startSite, ADMIN_KEY } from "./local-site.mjs";

const SHOTS = process.env.SCENARIO_SHOTS || "";
const CRITS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"];
let site, browser, BASE;
const ownDialogs = new WeakSet();   // pages whose scenario answers "leave this page?" questions itself

before(async () => {
  site = await startSite();
  BASE = `http://localhost:${site.port}`;   // localhost counts as a secure address, as the real https site is
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { if (browser) await browser.close(); if (site) site.stop(); });

// ---- Helpers ----------------------------------------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const literally = s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
async function until(check, what, ms = 10000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error("Waited " + ms / 1000 + "s for " + what + (last ? " (" + last.message.split("\n")[0] + ")" : ""));
}
const text = (page, sel = "body") => page.locator(sel).first().innerText();
const shows = (page, re, sel = "body", ms) => until(async () => re.test(await text(page, sel)), `${sel} to show ${re}`, ms);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png") }); }

// Each scenario gets fresh browsers ("people") and fails if any page had a script error or a script the site's
// security policy blocked.
function scenario(name, fn) {
  test(name, { timeout: 180000 }, async () => {
    const contexts = [], problems = [];
    const watch = (p, who) => {
      p.on("pageerror", e => problems.push(`${who}: ${e.message}`));
      p.on("console", m => { if (/Content Security Policy|Refused to/.test(m.text())) problems.push(`${who}: ${m.text()}`); });
      // A person who reloads or leaves with a change the site couldn't save is asked first; here they say "leave".
      p.on("dialog", d => { if (!ownDialogs.has(p)) d.accept().catch(() => {}); });
    };
    const person = async (who, options = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
      contexts.push(ctx);
      ctx.on("page", p => watch(p, who));
      return { ctx, page: await ctx.newPage() };
    };
    try { await fn(person); }
    finally { for (const c of contexts) await c.close().catch(() => {}); }
    assert.deepEqual(problems, [], "no page had a script error or a blocked script");
  });
}

// The owner, on the admin page.
async function ownerSignsIn(page) {
  await page.goto(BASE + "/admin");
  await page.fill("#key", ADMIN_KEY);
  await page.click("#keygo");
  await page.waitForSelector("#invite");
}
async function ownerInvites(page, { name, email = "", note = "", cases = [] }) {
  await page.fill("#iname", name);
  if (email) await page.fill("#iemail", email);
  if (note) await page.fill("#inote", note);
  for (const c of cases) await page.check(`input[name=newcases][value=${c}]`);
  await page.click("#invite");
  await page.waitForSelector("#lk");
  return page.innerText("#lk");
}
// One person's block on the admin page, and its "Change cases, links, or reopen a case" section opened.
const personBox = (page, name) => page.locator("div.crit", { has: page.locator("div.name", { hasText: name }) });
async function ownerOpensChanges(page, name) {
  const box = personBox(page, name);
  if (!(await box.locator("details").evaluate(d => d.open))) await box.locator("summary").click();
  return box;
}
async function ownerClicksTwice(page, name, label) {
  const box = await ownerOpensChanges(page, name);
  await box.locator("button", { hasText: label }).click();
  await box.locator("button", { hasText: /Click again/ }).click();
}
async function ownerLog(page) {
  await page.click("#showlog");
  await page.waitForSelector("table.log");
  return page.locator("table.log tr").allInnerTexts();   // newest first
}

// Setup shortcuts through the owner's API, for scenarios where inviting isn't the point.
async function ownerApi(path, body) {
  const r = await fetch(site.base + path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-Labeling": "1", "Content-Type": "application/json", Authorization: "Bearer " + ADMIN_KEY } });
  assert.ok(r.ok, `${path} answered ${r.status}`);
  return r.json();
}
async function invited(name, cases) {
  const r = await ownerApi("/api/admin/labelers", { invited_name: name, cases });
  return { id: r.id, link: r.link.replace(/^https?:\/\/[^/]+/, BASE) };
}
const exported = async () => (await ownerApi("/api/admin/export")).labels;

// A labeler.
async function opensLink(page, link, name) {
  await page.goto(link);
  if (name) await shows(page, literally("This is the personal link for " + name + "."));
  await page.click("#go");
  await page.waitForURL(/\/app(#.*)?$/);
}
async function agrees(page, { name, role = "" } = {}) {
  await page.waitForSelector("#cgo");
  if (name !== undefined) await page.fill("#cname", name);
  if (role) await page.fill("#crole", role);
  await page.check("#agree1");
  await page.check("#agree2");
  await page.click("#cgo");
  await page.waitForSelector('h2:has-text("Your cases")');
}
async function startsLabeling(page, link, name) { await opensLink(page, link); await agrees(page, { name }); }
async function opensCase(page, caseId) {
  await page.click(`[data-open="${caseId}"]`);
  await page.waitForSelector("#formcol .crit");
}
const picks = (page, crit, status) => page.check(`#formcol input[name="${crit}"][value="${status}"]`);
const routes = (page, r) => page.check(`#formcol input[name=routing][value=${r}]`);
async function cites(page, crit, which = "first") {
  const det = page.locator(`#formcol details[data-k="${crit}"]`);
  if (!(await det.evaluate(d => d.open))) await det.locator("summary").click();
  const boxes = det.locator("input[type=checkbox]");
  const box = which === "first" ? boxes.first() : boxes.last();
  const id = await box.getAttribute("value");
  await box.check();
  return id;
}
const saved = page => until(async () => { const t = await text(page, "#state"); return /Saved/.test(t) && !/Saving/.test(t); }, "the line under the form to say Saved");
async function submits(page) {
  await page.click("#submit");
  await shows(page, /After you submit, this case is locked/, "#modal");
  await page.click("#mok");
  await shows(page, /This case is locked\./, "#formcol");
}
async function homeRow(page, caseName) { return page.locator("table.cases tr", { has: page.locator("td b", { hasText: caseName }) }).innerText(); }
async function serverCopy(page, caseId) { return (await page.request.get(BASE + "/api/labels/" + caseId)).json(); }
const checked = (page, crit, status) => page.isChecked(`#formcol input[name="${crit}"][value="${status}"]`);
// A switched-off button is greyed out, so it doesn't look clickable.
async function looksOff(page, sel) { return Number(await page.locator(sel).evaluate(b => getComputedStyle(b).opacity)) < 0.6; }

// ---- Scenarios --------------------------------------------------------------------------------------------------------

scenario("1. An invited clinician's first visit, from the owner's invite to the downloaded labels", async person => {
  // The owner signs in. A wrong key is refused with a plain message; the right one opens the page.
  const { page: owner } = await person("owner", { permissions: ["clipboard-read", "clipboard-write"] });
  await owner.goto(BASE + "/admin");
  await owner.fill("#key", "not-the-key-not-the-key-not-the-key");
  await owner.click("#keygo");
  await shows(owner, /The admin key is wrong\./, "#keyerr");
  await owner.fill("#key", "  " + ADMIN_KEY + "  ");   // pasted with stray spaces: still works
  await owner.click("#keygo");
  await owner.waitForSelector("#invite");

  // The owner invites Dr. Dabs with two cases and copies the link.
  const link = await ownerInvites(owner, { name: "Dr. Dabs", email: "dabs@example.org", note: "consult after Gemini", cases: ["case_01", "practice_a"] });
  assert.match(link, literally(BASE + "/l/"));
  await owner.click("#copy");
  await shows(owner, /Copied/, "#copy");
  assert.equal(await owner.evaluate(() => navigator.clipboard.readText()), link, "the copied link is the one shown");
  const dabsBox = personBox(owner, "Dr. Dabs");
  assert.match(await dabsBox.innerText(), /Hasn't opened the link and agreed yet/);
  assert.match(await dabsBox.innerText(), /Case 01: not started/);
  assert.match(await dabsBox.innerText(), /Practice A: not started/);
  await shot(owner, "01-owner-invited");

  // Dr. Dabs opens the link. Opening alone signs nothing in; Continue does.
  const { ctx: dabsBrowser, page: dabs } = await person("Dr. Dabs");
  await dabs.goto(link);
  await shows(dabs, /This is the personal link for Dr\. Dabs\./);
  assert.equal((await dabsBrowser.cookies()).length, 0, "no cookie before Continue");
  await shot(dabs, "02-continue-page");
  await dabs.click("#go");
  await dabs.waitForURL(/\/app/);

  // The welcome page: the name is filled in, both boxes are needed, and it says the project is public.
  await dabs.waitForSelector("#cgo");
  assert.equal(await dabs.inputValue("#cname"), "Dr. Dabs");
  assert.match(await text(dabs, "main"), /The project is public/);
  await dabs.click("#cgo");
  await shows(dabs, /both boxes need to be ticked/, "#cerr");
  await shot(dabs, "03-welcome");
  await agrees(dabs, { role: "Cardiothoracic surgeon" });

  // The home page: a greeting, the training, and only the two assigned cases, not started.
  assert.match(await text(dabs, "main"), /Welcome, Dr\. Dabs/);
  assert.match(await text(dabs, "main"), /You have 2 cases to label/);
  assert.match(await homeRow(dabs, "Case 01"), /Not started/);
  assert.match(await homeRow(dabs, "Practice A"), /Not started/);
  assert.equal(await dabs.locator("table.cases tr").count(), 3, "a header row and two cases");
  await shot(dabs, "04-home");

  // The policy panel opens and closes.
  await dabs.click("#showref");
  await shows(dabs, /LCD L34220/, "#refdlg");
  await dabs.click("#closeref");
  assert.equal(await dabs.isVisible("#refdlg"), false);

  // The training opens in a new tab with the note for invited labelers, and its walkthrough runs.
  const [training] = await Promise.all([dabsBrowser.waitForEvent("page"), dabs.click('a:has-text("Open the training")')]);
  await training.waitForLoadState();
  await shows(training, /A note for invited labelers/);
  await training.waitForSelector("#guidedlg", { state: "visible" });
  await training.click("#closeguide");
  await training.click("#wstart");
  await training.waitForSelector("#walkcard", { state: "visible" });
  const step0 = await text(training, "#walkcard");
  await training.click("#wnext");
  await shows(training, /Step 1\./, "#walkcard");
  assert.notEqual(await text(training, "#walkcard"), step0, "Next moves the walkthrough on");
  await shot(training, "05-training");
  await training.close();

  // Dr. Dabs ticks "I've done the training"; the date appears.
  await dabs.check("#trained");
  await shows(dabs, /I've done the training \(/, "main");

  // Case 01 opens; Next case goes to Practice A.
  await opensCase(dabs, "case_01");
  await dabs.click("#next");
  await shows(dabs, /Your labels, Practice A/, "#formcol");
  assert.ok(await dabs.isVisible("#prev"), "Previous case is offered");

  // Practice A, answered in full. Submit stays off until it is complete.
  await picks(dabs, "C1_red_flag", "unsupported");
  await picks(dabs, "C2_conservative_4wk", "supported");
  const c2 = await cites(dabs, "C2_conservative_4wk", "first");
  await picks(dabs, "C3_informs_management", "supported");
  const c3 = await cites(dabs, "C3_informs_management", "last");
  await picks(dabs, "C4_no_duplicate_imaging", "supported");
  assert.ok(await dabs.isDisabled("#submit"), "Submit stays off before the routing is chosen");
  assert.ok(await looksOff(dabs, "#submit"), "and looks switched off");
  await routes(dabs, "approve");
  await saved(dabs);
  await shows(dabs, /^Complete\./, "#state");
  assert.ok(await dabs.isEnabled("#submit"));
  await shot(dabs, "06-practice-a-complete");

  // Leaving and coming back keeps the answers; the home page says it's ready.
  await dabs.click("#back");
  assert.match(await homeRow(dabs, "Practice A"), /Ready to submit/);
  await opensCase(dabs, "practice_a");
  assert.ok(await checked(dabs, "C3_informs_management", "supported"));
  assert.match(await text(dabs, "#formcol"), /Evidence \(1 selected\)/);

  // Submit asks first, then locks the case.
  await dabs.click("#submit");
  await shows(dabs, /Submit Practice A\?/, "#modal");
  await dabs.click("#mcancel");
  assert.equal(await dabs.isVisible("#modal"), false, "Cancel closes the question");
  assert.ok(await dabs.isEnabled("#submit"), "and nothing was submitted");
  await submits(dabs);
  assert.ok(await dabs.isDisabled('#formcol input[name=routing][value=route]'), "a submitted case can't be changed");
  await shot(dabs, "07-locked");
  await dabs.click("#back");
  assert.match(await homeRow(dabs, "Practice A"), /Submitted/);
  assert.match(await homeRow(dabs, "Practice A"), /View/);

  // The owner refreshes and sees the credit, the training, and the progress.
  await owner.click("#refresh");
  await until(async () => /Practice A: submitted/.test(await personBox(owner, "Dr. Dabs").innerText()), "the owner to see Practice A submitted");
  const box = await personBox(owner, "Dr. Dabs").innerText();
  assert.match(box, /Credited as Dr\. Dabs, Cardiothoracic surgeon/);
  assert.match(box, /says they did the training/);
  assert.match(box, /dabs@example\.org; consult after Gemini/);
  assert.match(box, /Case 01: not started/);
  await shot(owner, "08-owner-progress");

  // The owner downloads the submitted labels: one file, holding exactly what Dr. Dabs submitted, with who and when.
  const [download] = await Promise.all([owner.waitForEvent("download"), owner.click("#export")]);
  assert.match(download.suggestedFilename(), /^submitted-labels-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(readFileSync(await download.path(), "utf8"));
  const rows = file.labels.filter(l => l.invited_name === "Dr. Dabs");
  assert.equal(rows.length, 1, "only the submitted case is in the file");
  const row = rows[0];
  assert.equal(row.case, "practice_a"); assert.equal(row.kind, "practice");
  assert.equal(row.credit_name, "Dr. Dabs"); assert.equal(row.role, "Cardiothoracic surgeon");
  assert.ok(row.consent_at && row.training_done_at && row.submitted_at);
  assert.equal(row.case_sha, CONTENT.cases.practice_a.case_sha, "it records which version of the case was shown");
  assert.deepEqual(row.label, {
    criteria: {
      C1_red_flag: { status: "unsupported", evidence: [] },
      C2_conservative_4wk: { status: "supported", evidence: [c2] },
      C3_informs_management: { status: "supported", evidence: [c3] },
      C4_no_duplicate_imaging: { status: "supported", evidence: [] },
    },
    routing: "approve", gap_criterion: "", gap_missing: "",
  });

  // The activity log tells the story in order.
  const log = (await ownerLog(owner)).filter(r => r.includes("Dr. Dabs")).reverse();
  const story = ["labeler invited", "signed in with link", "consent", "training marked done", "label started", "label submitted"];
  let at = 0;
  for (const r of log) if (at < story.length && r.includes(story[at])) at++;
  assert.equal(at, story.length, "the log shows, in order: " + story.join(", ") + "\n" + log.join("\n"));
  await shot(owner, "09-owner-activity");
});

scenario("2. A documentation request, with the gap typed just before leaving the case", async person => {
  const { link } = await invited("Requester", ["practice_b"]);
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_b");
  for (const k of CRITS) await picks(page, k, "supported");
  await routes(page, "request");
  assert.ok(await page.isVisible("#gapbox"), "a request asks which criterion and what is missing");
  assert.ok(await page.isDisabled("#submit"), "a request without its gap can't be submitted");
  await page.selectOption("#gapc", "C2");
  await page.fill("#gapm", "the therapy notes from the last six weeks");
  await page.click("#back");   // straight away, before the typing pause has passed
  assert.match(await homeRow(page, "Practice B"), /Ready to submit/);
  assert.equal((await serverCopy(page, "practice_b")).label.gap_missing, "the therapy notes from the last six weeks", "the typed gap reached the site");

  // Switching the routing away from request clears the gap, and switching back asks for it again.
  await opensCase(page, "practice_b");
  await routes(page, "approve");
  assert.equal(await page.isVisible("#gapbox"), false);
  await routes(page, "request");
  assert.equal(await page.inputValue("#gapm"), "");
  assert.ok(await page.isDisabled("#submit"));
  await page.selectOption("#gapc", "C3");
  await page.fill("#gapm", "the surgical plan");
  await page.click("body", { position: { x: 5, y: 5 } });
  await saved(page);
  await submits(page);
  assert.equal(await page.inputValue("#gapm"), "the surgical plan");
  const row = (await exported()).find(l => l.invited_name === "Requester");
  assert.equal(row.label.routing, "request"); assert.equal(row.label.gap_criterion, "C3"); assert.equal(row.label.gap_missing, "the surgical plan");
});

scenario("3. Coming back later: the same browser goes straight in; another device needs only the link", async person => {
  const { link } = await invited("Returner", ["practice_a"]);
  const { ctx: laptop, page } = await person("laptop");
  await startsLabeling(page, link);
  await opensCase(page, "practice_a");
  await picks(page, "C1_red_flag", "unsupported");
  await picks(page, "C2_conservative_4wk", "undeterminable");
  await saved(page);
  await shows(page, /Not complete yet/, "#state");

  // Reloading the page reopens the same case with the answers.
  await page.reload();
  await page.waitForSelector("#formcol .crit");
  assert.ok(await checked(page, "C2_conservative_4wk", "undeterminable"));

  // Later, in the same browser: no link needed, no welcome page again.
  await page.close();
  const later = await laptop.newPage();
  await later.goto(BASE + "/app");
  await later.waitForSelector('h2:has-text("Your cases")');
  assert.match(await homeRow(later, "Practice A"), /Started/);

  // On another device: the link, then Continue, and straight to the cases with the answers there.
  const { page: phone } = await person("second device");
  await opensLink(phone, link, "Returner");
  await phone.waitForSelector('h2:has-text("Your cases")');
  await opensCase(phone, "practice_a");
  assert.ok(await checked(phone, "C1_red_flag", "unsupported"));
  assert.ok(await checked(phone, "C2_conservative_4wk", "undeterminable"));
  await picks(phone, "C3_informs_management", "supported");
  await picks(phone, "C4_no_duplicate_imaging", "supported");
  await routes(phone, "route");
  await saved(phone);
  await submits(phone);

  // Back on the laptop, the case shows as submitted.
  await opensCase(later, "practice_a");
  await shows(later, /This case is locked\./, "#formcol");
  assert.ok(await checked(later, "routing", "route"));
});

scenario("4. Two labelers on the same case never see each other's answers, and each is credited separately", async person => {
  const a = await invited("Labeler Ana", ["case_02"]);
  const b = await invited("Labeler Ben", ["case_02"]);
  const { page: ana } = await person("Ana");
  const { page: ben } = await person("Ben");
  await startsLabeling(ana, a.link, "Ana A.");
  await startsLabeling(ben, b.link, "Ben B.");

  await opensCase(ana, "case_02");
  for (const k of CRITS) await picks(ana, k, "supported");
  await routes(ana, "approve");
  await saved(ana);
  await submits(ana);

  await opensCase(ben, "case_02");
  for (const k of CRITS) assert.equal(await ben.locator(`#formcol input[name="${k}"]:checked`).count(), 0, `Ben sees no answer for ${k}`);
  assert.equal(await ben.locator("#formcol input[name=routing]:checked").count(), 0);
  for (const k of CRITS) await picks(ben, k, "undeterminable");
  await routes(ben, "route");
  await saved(ben);
  await submits(ben);

  const rows = (await exported()).filter(l => l.case === "case_02" && ["Ana A.", "Ben B."].includes(l.credit_name));
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.credit_name === "Ana A.").labeler_id, a.id);
  assert.equal(rows.find(r => r.credit_name === "Ana A.").label.routing, "approve");
  assert.equal(rows.find(r => r.credit_name === "Ben B.").labeler_id, b.id);
  assert.equal(rows.find(r => r.credit_name === "Ben B.").label.routing, "route");
});

scenario("5. A labeler sees only the cases assigned to them, even by typing an address", async person => {
  const { link } = await invited("Only B", ["practice_b"]);
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  assert.equal(await page.locator("table.cases tr").count(), 2, "one case listed");
  await opensCase(page, "practice_b");
  assert.deepEqual(await page.locator("#nav button").allInnerTexts(), ["Practice B"], "the case buttons show only Practice B");

  await page.goto("about:blank");
  await page.goto(BASE + "/app#case=case_03");   // typing an unassigned case's address
  await page.waitForSelector('h2:has-text("Your cases")');
  assert.equal(await page.locator("#formcol").count(), 0, "an unassigned case doesn't open");
  assert.equal((await page.request.get(BASE + "/api/labels/case_03")).status(), 404);
  assert.equal((await page.request.put(BASE + "/api/labels/case_03", { headers: { "X-Labeling": "1" }, data: { label: {}, rev: 0, content_sha: CONTENT.content_sha } })).status(), 404);
});

scenario("6. The owner changes someone's cases; a case with saved answers stays", async person => {
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const link = await ownerInvites(owner, { name: "Reassigned Person", cases: ["case_03", "case_04"] });
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "case_03");
  await picks(page, "C1_red_flag", "undeterminable");
  await saved(page);

  // Swap Case 04 for Practice A.
  await owner.click("#refresh");
  let box = await ownerOpensChanges(owner, "Reassigned Person");
  await box.locator("input[value=case_04]").uncheck();
  await box.locator("input[value=practice_a]").check();
  await box.locator("button", { hasText: "Save the cases" }).click();
  await until(async () => /Practice A: not started/.test(await personBox(owner, "Reassigned Person").innerText()), "the new case on the admin page");
  assert.doesNotMatch(await personBox(owner, "Reassigned Person").innerText(), /Case 04/);

  await page.click("#back");
  await page.waitForSelector("table.cases");
  const list = await page.locator("table.cases td b").allInnerTexts();
  assert.deepEqual(list, ["Case 03", "Practice A"]);

  // Taking away Case 03, which has a saved answer, is refused with a clear message.
  box = await ownerOpensChanges(owner, "Reassigned Person");
  await box.locator("input[value=case_03]").uncheck();
  await box.locator("button", { hasText: "Save the cases" }).click();
  await until(async () => /already have saved labels and stay assigned: Case 03/.test(await personBox(owner, "Reassigned Person").innerText()), "the refusal message");
  assert.ok((await ownerLog(owner)).some(r => r.includes("cases assigned")));
});

scenario("7. A lost link: the owner makes a new one; the old one stops at once and saved answers stay", async person => {
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const oldLink = await ownerInvites(owner, { name: "Lost Link", cases: ["practice_a"] });
  const { page } = await person("labeler");
  await startsLabeling(page, oldLink);
  await opensCase(page, "practice_a");
  await picks(page, "C1_red_flag", "supported");
  await saved(page);

  await owner.click("#refresh");
  await ownerClicksTwice(owner, "Lost Link", "Make a new link");
  const newLink = await personBox(owner, "Lost Link").locator("#lk").innerText();
  assert.notEqual(newLink, oldLink);

  // The browser signed in with the old link is signed out at its next change.
  await picks(page, "C2_conservative_4wk", "supported");
  await shows(page, /Not saved: your link was turned off or your session ended/, "#state");
  assert.ok(await page.isDisabled("#submit"));
  await page.reload();
  await shows(page, /Please open the personal link you were sent/);
  await page.goto(oldLink);
  await shows(page, /This link isn't valid any more/);

  // The new link works, with no welcome page again, and the saved answer is there (the refused one is not).
  await opensLink(page, newLink, "Lost Link");
  await page.waitForSelector('h2:has-text("Your cases")');
  await opensCase(page, "practice_a");
  assert.ok(await checked(page, "C1_red_flag", "supported"));
  assert.equal(await checked(page, "C2_conservative_4wk", "supported"), false);
});

scenario("8. Turning a link off while someone is labeling, then turning them back on", async person => {
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const link = await ownerInvites(owner, { name: "Switched Off", cases: ["practice_b"] });
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_b");

  await owner.click("#refresh");
  await ownerClicksTwice(owner, "Switched Off", "Turn the link off");
  const offTag = () => personBox(owner, "Switched Off").locator("div.name .chip", { hasText: "link off" }).count();
  await until(async () => (await offTag()) === 1, "the 'link off' tag");

  await picks(page, "C1_red_flag", "supported");
  await shows(page, /Not saved: your link was turned off/, "#state");
  await page.goto(link);
  await shows(page, /This link isn't valid any more/);

  await ownerClicksTwice(owner, "Switched Off", "Make a new link");
  const fresh = await personBox(owner, "Switched Off").locator("#lk").innerText();
  assert.equal(await offTag(), 0, "the 'link off' tag is gone");
  await opensLink(page, fresh, "Switched Off");
  await opensCase(page, "practice_b");
  await picks(page, "C1_red_flag", "supported");
  await saved(page);
});

scenario("9. The owner reopens a submitted case with a reason; the labeler fixes it and submits again", async person => {
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const link = await ownerInvites(owner, { name: "Fixer", cases: ["practice_a"] });
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_a");
  for (const k of CRITS) await picks(page, k, "supported");
  await routes(page, "approve");
  await saved(page);
  await submits(page);
  const first = (await exported()).find(l => l.invited_name === "Fixer");

  await owner.click("#refresh");
  let box = await ownerOpensChanges(owner, "Fixer");
  await box.locator("button", { hasText: "Reopen it" }).click();
  await until(async () => /please give a reason/.test(await personBox(owner, "Fixer").innerText()), "the request for a reason");
  box = await ownerOpensChanges(owner, "Fixer");
  await box.locator("input[placeholder^=Reason]").fill("C4 was answered too quickly");
  await box.locator("button", { hasText: "Reopen it" }).click();
  await until(async () => /Practice A: complete/.test(await personBox(owner, "Fixer").innerText()), "Practice A reopened");

  await page.click("#back");
  assert.match(await homeRow(page, "Practice A"), /Ready to submit/);
  await opensCase(page, "practice_a");
  assert.ok(await page.isEnabled("#formcol input[name=C4_no_duplicate_imaging][value=unsupported]"), "editable again");
  await picks(page, "C4_no_duplicate_imaging", "unsupported");
  await routes(page, "route");
  await saved(page);
  await submits(page);

  const second = (await exported()).find(l => l.invited_name === "Fixer");
  assert.equal(second.label.criteria.C4_no_duplicate_imaging.status, "unsupported");
  assert.ok(second.revision > first.revision);
  const log = await ownerLog(owner);
  assert.ok(log.some(r => r.includes("label reopened") && r.includes("C4 was answered too quickly")), "the reason is in the log");
  assert.equal(log.filter(r => r.includes("Fixer") && r.includes("label submitted")).length, 2);
});

scenario("10. Removing a person who asks: labels and details go, the log keeps what happened without them", async person => {
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const link = await ownerInvites(owner, { name: "Remove Me Please", email: "remove@example.org", cases: ["practice_a"] });
  const { page } = await person("labeler");
  await startsLabeling(page, link, "Ms. Remove Me");
  await opensCase(page, "practice_a");
  for (const k of CRITS) await picks(page, k, "unsupported");
  await routes(page, "route");
  await saved(page);
  await submits(page);
  const id = (await exported()).find(l => l.credit_name === "Ms. Remove Me").labeler_id;

  await owner.click("#refresh");
  await ownerClicksTwice(owner, "Remove Me Please", "Remove this person's details");
  await until(async () => (await personBox(owner, "Remove Me Please").count()) === 0, "the person to leave the list");

  assert.ok(!(await exported()).some(l => l.labeler_id === id), "their labels are gone from the download");
  const log = (await ownerLog(owner)).join("\n");
  assert.ok(!/Remove Me|remove@example/.test(log), "no name, email, or answers left in the log");
  assert.ok(log.includes(id), "their entries show only their id");
  assert.ok(log.includes("details removed on request"));
  assert.ok(!/Remove Me|remove@example/.test(await text(owner, "main")));
  await page.reload();
  await shows(page, /Please open the personal link you were sent/);
  await page.goto(link);
  await shows(page, /This link isn't valid any more/);
});

scenario("11. Two people on one shared computer: the second link says who is signed in before switching", async person => {
  const a = await invited("Avery", ["practice_a"]);
  const b = await invited("Blair", ["practice_a"]);
  const { page } = await person("shared computer");
  await startsLabeling(page, a.link, "Avery Adams");
  await opensCase(page, "practice_a");
  await picks(page, "C1_red_flag", "supported");
  await saved(page);

  await page.goto(b.link);
  await shows(page, /This browser is signed in as Avery Adams\. Continuing switches it to Blair\./);
  await page.click("#go");
  await page.waitForSelector("#cgo");
  assert.equal(await page.inputValue("#cname"), "Blair", "Blair's own welcome page");
  await agrees(page);
  assert.match(await text(page, "main"), /Welcome, Blair/);
  await opensCase(page, "practice_a");
  assert.equal(await page.locator("#formcol input:checked").count(), 0, "Blair doesn't see Avery's answer");
});

scenario("12. Losing the internet while labeling: nothing is lost, Submit waits, and closing the tab warns", async person => {
  const { link } = await invited("Offline Person", ["practice_a"]);
  const { ctx, page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_a");
  for (const k of CRITS.slice(0, 3)) await picks(page, k, "supported");
  await saved(page);

  await ctx.setOffline(true);
  await picks(page, "C4_no_duplicate_imaging", "supported");
  await routes(page, "approve");
  await shows(page, /Not saved yet: Couldn't reach the site/, "#state");
  await shows(page, /Not saved: couldn't reach the site\. Your answers are still on this page/, "#state", 40000);
  assert.ok(await page.isVisible("#retry"));
  assert.ok(await page.isDisabled("#submit"), "Submit waits until the last change is saved");
  assert.ok(await looksOff(page, "#submit"), "and looks switched off");
  await shot(page, "12-offline");

  // Closing the tab now asks first.
  let asked = "";
  ownDialogs.add(page);
  page.once("dialog", d => { asked = d.type(); d.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await until(async () => asked === "beforeunload", "the leave-page question");
  assert.equal(page.isClosed(), false, "staying on the page keeps it open");

  await ctx.setOffline(false);
  await page.click("#retry");
  await saved(page);
  assert.ok(await page.isEnabled("#submit"));
  await submits(page);
  const server = await serverCopy(page, "practice_a");
  assert.equal(server.label.criteria.C4_no_duplicate_imaging.status, "supported");
  assert.equal(server.label.routing, "approve");
});

scenario("13. The same case open in two tabs: the older tab can't overwrite the newer answers", async person => {
  const { link } = await invited("Two Tabs", ["practice_b"]);
  const { ctx, page: tab1 } = await person("labeler");
  await startsLabeling(tab1, link);
  await opensCase(tab1, "practice_b");
  const tab2 = await ctx.newPage();
  await tab2.goto(BASE + "/app#case=practice_b");
  await tab2.waitForSelector("#formcol .crit");

  await picks(tab1, "C1_red_flag", "unsupported");
  await saved(tab1);
  await picks(tab2, "C4_no_duplicate_imaging", "undeterminable");
  await shows(tab2, /changed in another tab or on another device/, "#formcol");
  assert.ok(await checked(tab2, "C1_red_flag", "unsupported"), "the older tab now shows the newer answer");
  assert.equal(await checked(tab2, "C4_no_duplicate_imaging", "undeterminable"), false, "its own refused change is not shown as saved");
  await shot(tab2, "13-two-tabs");
  assert.equal((await serverCopy(tab1, "practice_b")).label.criteria.C1_red_flag.status, "unsupported");

  // Carrying on in the second tab works.
  await picks(tab2, "C4_no_duplicate_imaging", "undeterminable");
  await saved(tab2);
  const server = (await serverCopy(tab2, "practice_b")).label.criteria;
  assert.equal(server.C1_red_flag.status, "unsupported");
  assert.equal(server.C4_no_duplicate_imaging.status, "undeterminable");
});

scenario("14. The cases are updated while a page is open: its next save asks for a reload, and saved answers stay", async person => {
  const { link } = await invited("Old Page", ["practice_a"]);
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_a");
  await picks(page, "C1_red_flag", "supported");
  await saved(page);
  // Stands in for a redeploy with changed case content: the open page now holds an older content fingerprint.
  await page.evaluate(() => { DATA.content_sha = "an-older-version-of-the-cases"; });
  await picks(page, "C2_conservative_4wk", "supported");
  await shows(page, /The cases were updated since this page was opened\. Reload the page; your saved answers are kept\./, "#state");
  assert.ok(await page.isDisabled("#submit"));
  await page.reload();
  await page.waitForSelector("#formcol .crit");
  assert.ok(await checked(page, "C1_red_flag", "supported"));
  await picks(page, "C2_conservative_4wk", "supported");
  await saved(page);
});

scenario("15. On a phone: the whole path fits the screen, and Go to the form jumps to the answers", async person => {
  const { link } = await invited("Phone Person", ["practice_a"]);
  const { page } = await person("phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const fits = async where => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where} fits the phone's width`);
  await page.goto(link);
  await fits("the Continue page");
  await page.locator("#go").tap();
  await page.waitForSelector("#cgo");
  await fits("the welcome page");
  await page.locator("#agree1").tap();
  await page.locator("#agree2").tap();
  await page.locator("#cgo").tap();
  await page.waitForSelector('h2:has-text("Your cases")');
  await fits("the home page");
  await page.locator('[data-open="practice_a"]').tap();
  await page.waitForSelector("#toform");
  await fits("the case page");
  assert.equal(await page.isVisible("header nav"), false, "the row of case buttons is hidden on a phone");
  await page.locator("#toform").tap();
  await until(async () => (await page.evaluate(() => document.getElementById("formcol").getBoundingClientRect().top)) < 200, "the form at the top of the screen");
  for (const k of CRITS) await page.locator(`#formcol input[name="${k}"][value=supported]`).tap();
  await page.locator("#formcol input[name=routing][value=approve]").tap();
  await saved(page);
  await page.locator("#submit").tap();
  await page.locator("#mok").tap();
  await shows(page, /This case is locked\./, "#formcol");
  await fits("the locked case");
  await shot(page, "15-phone");
});

scenario("16. Keyboard only: a whole case, the gap, and the Submit question, without a mouse", async person => {
  const { link } = await invited("Keyboard Person", ["practice_b"]);
  const { page } = await person("labeler");
  await startsLabeling(page, link);
  const focused = () => page.evaluate(() => { const a = document.activeElement; return { id: a.id, name: a.name || "", value: a.value || "", open: a.dataset ? a.dataset.open || "" : "", crit: a.dataset ? a.dataset.crit || "" : "", tag: a.tagName }; });
  async function tabTo(want, what, max = 120) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const f = await focused();
      if (Object.entries(want).every(([k, v]) => f[k] === v)) return;
    }
    throw new Error("Tab never reached " + what);
  }
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await tabTo({ open: "practice_b" }, "the Open button");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#formcol .crit");

  await tabTo({ name: "C1_red_flag" }, "C1");
  await page.keyboard.press("Space");                // supported
  await page.keyboard.press("ArrowRight");           // moves to unsupported
  assert.ok(await checked(page, "C1_red_flag", "unsupported"));
  assert.equal((await focused()).name, "C1_red_flag", "the focus stays on the answer after the form redraws");

  await tabTo({ name: "C2_conservative_4wk" }, "C2");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");                  // the Evidence list
  assert.equal((await focused()).tag, "SUMMARY");
  await page.keyboard.press("Enter");                // opens it
  await page.keyboard.press("Tab");
  const cited = (await focused()).value;
  await page.keyboard.press("Space");                // ticks the first id
  assert.equal((await focused()).crit, "C2_conservative_4wk", "the focus stays in the evidence list");
  assert.match(await text(page, "#formcol"), /Evidence \(1 selected\)/);

  await tabTo({ name: "C3_informs_management" }, "C3");
  await page.keyboard.press("Space");
  await tabTo({ name: "C4_no_duplicate_imaging" }, "C4");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");           // undeterminable
  await tabTo({ name: "routing" }, "the routing");
  await page.keyboard.press("Space");                // approve
  await page.keyboard.press("ArrowRight");           // request
  assert.ok(await page.isVisible("#gapbox"));
  await tabTo({ id: "gapc" }, "the gap's criterion");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");   // Criterion, C1, C2, C3, C4
  assert.equal(await page.inputValue("#gapc"), "C4");
  await page.keyboard.press("Tab");
  assert.equal((await focused()).id, "gapm");
  await page.keyboard.type("the earlier imaging report");
  await tabTo({ id: "submit" }, "Submit this case");

  await page.keyboard.press("Enter");
  await shows(page, /Submit Practice B\?/, "#modal");
  assert.equal((await focused()).id, "mok", "the question takes the focus, on its Submit button");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#modal"), false, "Escape closes the question");
  assert.equal((await focused()).id, "submit", "and the focus goes back to Submit this case");
  await page.keyboard.press("Enter");
  await shows(page, /Submit Practice B\?/, "#modal");
  await page.keyboard.press("Enter");
  await shows(page, /This case is locked\./, "#formcol");

  const label = (await serverCopy(page, "practice_b")).label;
  assert.equal(label.criteria.C1_red_flag.status, "unsupported");
  assert.deepEqual(label.criteria.C2_conservative_4wk, { status: "supported", evidence: [cited] });
  assert.equal(label.criteria.C4_no_duplicate_imaging.status, "undeterminable");
  assert.equal(label.routing, "request"); assert.equal(label.gap_criterion, "C4"); assert.equal(label.gap_missing, "the earlier imaging report");
});

scenario("17. Wrong addresses and wrong keys get plain messages, and Sign out forgets the admin key", async person => {
  const { page } = await person("visitor");
  let r = await page.goto(BASE + "/");
  assert.equal(r.status(), 200);
  await shows(page, /Invited labelers only/);
  r = await page.goto(BASE + "/app");
  assert.equal(r.status(), 401);
  await shows(page, /Please open the personal link you were sent/);
  r = await page.goto(BASE + "/training");
  assert.equal(r.status(), 401);
  r = await page.goto(BASE + "/l/a-made-up-link");
  assert.equal(r.status(), 404);
  await shows(page, /This link isn't valid any more/);
  r = await page.goto(BASE + "/nowhere");
  assert.equal(r.status(), 404);
  await shows(page, /Page not found/);

  await ownerSignsIn(page);
  await page.reload();
  await page.waitForSelector("#invite");   // the tab keeps the key while it is open
  await page.click("#signout");
  await page.waitForSelector("#keygo");
  await page.reload();
  await page.waitForSelector("#keygo");
  assert.equal(await page.isVisible("#invite"), false, "after Sign out, the key is gone");
});

scenario("18. Names with accents, apostrophes, and symbols show exactly as typed everywhere", async person => {
  const name = "Zoë O'Brien-Núñez <b>MD</b> $& $` & co";
  const { page: owner } = await person("owner");
  await ownerSignsIn(owner);
  const link = await ownerInvites(owner, { name, cases: ["practice_a"] });
  assert.equal(await personBox(owner, "Zoë O'Brien").locator("div.name").evaluate(e => e.firstChild.textContent.trim()), name, "the admin list");

  const { page } = await person("labeler");
  await page.goto(link);
  assert.equal(await page.locator("main b").first().innerText(), name, "the Continue page");
  await shot(page, "18-name-continue");
  await page.click("#go");
  await page.waitForSelector("#cgo");
  assert.equal(await page.inputValue("#cname"), name, "the welcome page");
  await agrees(page, { role: "R&D <lead>" });
  assert.match(await text(page, "main"), literally("Welcome, " + name));

  // A second person's link opened in this browser names this one exactly too.
  const other = await invited("Next Person", ["practice_b"]);
  await page.goto(other.link);
  await shows(page, literally("This browser is signed in as " + name + ". Continuing switches it to Next Person."));

  await owner.click("#refresh");
  await until(async () => (await personBox(owner, "Zoë O'Brien").innerText()).includes("Credited as " + name + ", R&D <lead>"), "the credit on the admin page");
});

scenario("19. Closing the tab a moment after typing the gap still saves it", async person => {
  const { link } = await invited("Quick Closer", ["practice_b"]);
  const { ctx, page } = await person("labeler");
  await startsLabeling(page, link);
  await opensCase(page, "practice_b");
  for (const k of CRITS) await picks(page, k, "undeterminable");
  await routes(page, "request");
  await page.selectOption("#gapc", "C1");
  await saved(page);
  await page.fill("#gapm", "typed, then the tab closed at once");
  await shows(page, /Saving\.\.\./, "#state");   // the line doesn't claim the typing is saved yet
  await page.close({ runBeforeUnload: true });   // "Leave the page?" is answered yes
  const later = await ctx.newPage();
  await until(async () => (await serverCopy(later, "practice_b")).label.gap_missing === "typed, then the tab closed at once", "the typed gap to reach the site");
});

scenario("20. A site deployed without an admin key says so on the admin page", async person => {
  const bare = await startSite({ adminKey: null });
  try {
    const { page } = await person("owner");
    await page.goto(`http://localhost:${bare.port}/admin`);
    await page.fill("#key", ADMIN_KEY);
    await page.click("#keygo");
    await shows(page, /The site has no admin key set\. Run the Deploy labeling site workflow again\./, "#keyerr");
  } finally { bare.stop(); }
});
