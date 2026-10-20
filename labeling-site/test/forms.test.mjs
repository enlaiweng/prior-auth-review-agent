// Positive and negative tests of each form on the labeling site, in a real browser (Chromium, driven by Playwright),
// against the real Worker code and an empty local database (test/local-site.mjs). Nothing touches Cloudflare.
//
//   positive: a person fills a form in correctly, and it does what it should.
//   negative: a person fills it in wrongly (or stops halfway), sees a plain message or a switched-off button, and
//             nothing is stored: everything the owner can see is the same afterwards.
//
// Run from labeling-site/: npm run scenarios   (it runs these with the scenarios)
// The answers below are made-up test inputs; they say nothing about any case.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startSite, ADMIN_KEY } from "./local-site.mjs";

let site, browser, BASE;
before(async () => {
  site = await startSite();
  BASE = `http://localhost:${site.port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { if (browser) await browser.close(); if (site) site.stop(); });

// Each test gets fresh browsers and fails on any script error or blocked script.
function formTest(kind, name, fn) {
  test(`${kind}: ${name}`, { timeout: 120000 }, async () => {
    const contexts = [], problems = [];
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on("pageerror", e => problems.push(e.message));
      page.on("console", m => { if (/Content Security Policy|Refused to/.test(m.text())) problems.push(m.text()); });
      page.on("dialog", d => d.accept().catch(() => {}));
      return page;
    };
    try { await fn(open); } finally { for (const c of contexts) await c.close().catch(() => {}); }
    assert.deepEqual(problems, [], "no script errors or blocked scripts");
  });
}
const positive = (name, fn) => formTest("positive", name, fn);
const negative = (name, fn) => formTest("negative", name, fn);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(check, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await check()) return; } catch (e) {} await sleep(100); }
  throw new Error("Waited for " + what);
}
const text = (page, sel) => page.locator(sel).first().innerText();
const shows = (page, sel, re) => until(async () => re.test(await text(page, sel)), `${sel} to show ${re}`);

// The owner's view through the API, to show a refused form stored nothing.
async function ownerApi(path, body) {
  const r = await fetch(site.base + path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-Labeling": "1", "Content-Type": "application/json", Authorization: "Bearer " + ADMIN_KEY } });
  return r.json();
}
async function world() {
  const [state, events, exp] = await Promise.all([ownerApi("/api/admin/state"), ownerApi("/api/admin/events"), ownerApi("/api/admin/export")]);
  return { labelers: state.labelers, lastEvent: events.events[0] ? events.events[0].id : 0, exported: exp.labels };
}
async function storesNothing(fn) { const b = await world(); await fn(); await sleep(400); assert.deepEqual(await world(), b, "nothing was stored"); }
let n = 0;
async function invited(cases = ["practice_a"]) {
  const r = await ownerApi("/api/admin/labelers", { invited_name: `Form person ${++n}`, cases });
  return { id: r.id, name: `Form person ${n}`, link: r.link.replace(/^https?:\/\/[^/]+/, BASE) };
}
const personBox = (page, name) => page.locator("div.crit", { has: page.locator("div.name", { hasText: name }) });

async function ownerPage(open) {
  const page = await open();
  await page.goto(BASE + "/admin");
  await page.fill("#key", ADMIN_KEY);
  await page.click("#keygo");
  await page.waitForSelector("#invite");
  return page;
}
async function openChanges(page, name) {
  const box = personBox(page, name);
  if (!(await box.locator("details").evaluate(d => d.open))) await box.locator("summary").click();
  return box;
}
async function labelerPage(open, link, { agree = true } = {}) {
  const page = await open();
  await page.goto(link);
  await page.click("#go");
  await page.waitForSelector("#cgo");
  if (agree) {
    await page.check("#agree1"); await page.check("#agree2"); await page.click("#cgo");
    await page.waitForSelector('h2:has-text("Your cases")');
  }
  return page;
}
async function openCase(page, id) { await page.click(`[data-open="${id}"]`); await page.waitForSelector("#formcol .crit"); }
const pick = (page, k, s) => page.check(`#formcol input[name="${k}"][value="${s}"]`);
const CRITS = ["C1_red_flag", "C2_conservative_4wk", "C3_informs_management", "C4_no_duplicate_imaging"];
const looksOff = async (page, sel) => (await page.isDisabled(sel)) && Number(await page.locator(sel).evaluate(b => getComputedStyle(b).opacity)) < 0.6;
const settled = page => until(async () => { const t = await text(page, "#state"); return /Saved|Not complete yet/.test(t) && !/Saving/.test(t); }, "saving to finish");

// ---- The admin sign-in -----------------------------------------------------------------------------------------------

positive("the admin sign-in: the right key opens the admin page", async open => {
  const page = await ownerPage(open);
  assert.ok(await page.isVisible('h2:has-text("Invite a labeler")'));
});
for (const [what, key] of [["an empty key", ""], ["a wrong key", "not-the-admin-key-not-the-admin-key"]]) {
  negative(`the admin sign-in with ${what}: a plain message, and the page stays closed`, async open => {
    const page = await open();
    await page.goto(BASE + "/admin");
    await page.fill("#key", key);
    await page.click("#keygo");
    await shows(page, "#keyerr", /The admin key is wrong\./);
    assert.equal(await page.isVisible("#invite"), false);
  });
}

// ---- Inviting a labeler -------------------------------------------------------------------------------------------------

positive("the invite form: a name, email, note, and cases give a link and a new person in the list", async open => {
  const page = await ownerPage(open);
  await page.fill("#iname", "Invited Through The Form");
  await page.fill("#iemail", "form@example.org");
  await page.fill("#inote", "met at the conference");
  await page.check("input[name=newcases][value=practice_b]");
  await page.click("#invite");
  await page.waitForSelector("#lk");
  assert.match(await text(page, "#lk"), /\/l\/[A-Za-z0-9_-]{43}$/);
  const box = await personBox(page, "Invited Through The Form").innerText();
  assert.match(box, /form@example\.org; met at the conference/);
  assert.match(box, /Practice B: not started/);
});
for (const [what, name] of [["no name", ""], ["a name of only spaces", "     "]]) {
  negative(`the invite form with ${what}: a plain message, and no one is added`, async open => {
    const page = await ownerPage(open);
    await storesNothing(async () => {
      await page.fill("#iname", name);
      await page.check("input[name=newcases][value=practice_a]");
      await page.click("#invite");
      await shows(page, "#ierr", /please enter a name/);
    });
    assert.equal(await page.locator("#lk").count(), 0, "no link shown");
  });
}
negative("the invite form's boxes stop at their limits: name 100, email 200, note 300 characters", async open => {
  const page = await ownerPage(open);
  await page.fill("#iname", "n".repeat(130));
  await page.fill("#iemail", "e".repeat(230));
  await page.fill("#inote", "o".repeat(330));
  assert.equal((await page.inputValue("#iname")).length, 100);
  assert.equal((await page.inputValue("#iemail")).length, 200);
  assert.equal((await page.inputValue("#inote")).length, 300);
});

// ---- Changing cases, links, reopening, removing ----------------------------------------------------------------------

positive("changing someone's cases: an added case appears at once", async open => {
  const p = await invited(["practice_a"]);
  const page = await ownerPage(open);
  const box = await openChanges(page, p.name);
  await box.locator("input[value=practice_b]").check();
  await box.locator("button", { hasText: "Save the cases" }).click();
  await until(async () => /Practice B: not started/.test(await personBox(page, p.name).innerText()), "the new case");
});
negative("taking away a case with a saved answer: a plain message, and the cases stay as they were", async open => {
  const p = await invited(["practice_a", "practice_b"]);
  const lab = await labelerPage(open, p.link);
  await openCase(lab, "practice_a");
  await pick(lab, "C1_red_flag", "supported");
  await settled(lab);
  const page = await ownerPage(open);
  await storesNothing(async () => {
    const box = await openChanges(page, p.name);
    await box.locator("input[value=practice_a]").uncheck();
    await box.locator("button", { hasText: "Save the cases" }).click();
    await until(async () => /stay assigned: Practice A/.test(await personBox(page, p.name).innerText()), "the refusal");
  });
});
negative("\"Make a new link\" clicked once asks to confirm and changes nothing", async open => {
  const p = await invited();
  const page = await ownerPage(open);
  await storesNothing(async () => {
    const box = await openChanges(page, p.name);
    await box.locator("button", { hasText: "Make a new link" }).click();
    await box.locator("button", { hasText: "Click again to confirm" }).waitFor();
  });
  const lab = await open();
  await lab.goto(p.link);
  assert.match(await text(lab, "main"), /personal link for/, "the old link still works");
});
positive("\"Make a new link\" clicked twice shows the new link, which works", async open => {
  const p = await invited();
  const page = await ownerPage(open);
  const box = await openChanges(page, p.name);
  await box.locator("button", { hasText: "Make a new link" }).click();
  await box.locator("button", { hasText: "Click again to confirm" }).click();
  const link = (await personBox(page, p.name).locator("#lk").innerText()).replace(/^https?:\/\/[^/]+/, BASE);
  const lab = await labelerPage(open, link, { agree: false });
  assert.ok(await lab.isVisible("#cgo"));
});
negative("\"Turn the link off\" and \"Remove\" clicked once ask to confirm and change nothing", async open => {
  const p = await invited();
  const page = await ownerPage(open);
  await storesNothing(async () => {
    const box = await openChanges(page, p.name);
    await box.locator("button", { hasText: "Turn the link off" }).click();
    await box.locator("button", { hasText: "Remove this person's details" }).click();
    assert.equal(await box.locator("button", { hasText: /Click again/ }).count(), 2);
  });
});
async function submittedFor(p) {
  const r = await fetch(site.base + "/api/session", { method: "POST", headers: { "X-Labeling": "1", "Content-Type": "application/json" }, body: JSON.stringify({ token: p.link.split("/l/")[1] }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const go = (path, body) => fetch(site.base + path, { method: "POST", headers: { "X-Labeling": "1", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  await go("/api/consent", { credit_name: "T", agree_credit: true, agree_rules: true });
  const content = (await (await fetch(site.base + "/api/cases", { headers: { Cookie: cookie } })).json()).content_sha;
  const c = { status: "supported", evidence: [] };
  await go("/api/labels/practice_a/submit", { label: { criteria: { C1_red_flag: c, C2_conservative_4wk: c, C3_informs_management: c, C4_no_duplicate_imaging: c }, routing: "approve" }, rev: 0, content_sha: content });
}
positive("reopening with a reason: the case is open again", async open => {
  const p = await invited();
  await submittedFor(p);
  const page = await ownerPage(open);
  const box = await openChanges(page, p.name);
  await box.locator("input[placeholder^=Reason]").fill("C2 needs another look");
  await box.locator("button", { hasText: "Reopen it" }).click();
  await until(async () => /Practice A: complete/.test(await personBox(page, p.name).innerText()), "the case reopened");
});
negative("reopening with no reason: a plain message, and the case stays submitted", async open => {
  const p = await invited();
  await submittedFor(p);
  const page = await ownerPage(open);
  await storesNothing(async () => {
    const box = await openChanges(page, p.name);
    await box.locator("button", { hasText: "Reopen it" }).click();
    await until(async () => /please give a reason/.test(await personBox(page, p.name).innerText()), "the request for a reason");
  });
  assert.match(await personBox(page, p.name).innerText(), /Practice A: submitted/);
});

// ---- The Continue page -----------------------------------------------------------------------------------------------

positive("the Continue button signs the person in", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link, { agree: false });
  assert.ok(await page.isVisible("#agree1"));
});
negative("Continue on a link turned off after the page was opened: a plain message, and no one is signed in", async open => {
  const p = await invited();
  const page = await open();
  await page.goto(p.link);
  await ownerApi(`/api/admin/labelers/${p.id}/revoke`, {});
  await storesNothing(async () => {
    await page.click("#go");
    await shows(page, "#err", /This link isn't valid any more/);
  });
  assert.match(page.url(), /\/l\//, "still on the Continue page");
  assert.ok(await page.isEnabled("#go"), "the button can be tried again");
});

// ---- The welcome page --------------------------------------------------------------------------------------------------

positive("the welcome page: a name, a role, and both boxes lead to the person's cases", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link, { agree: false });
  await page.fill("#cname", "  Dr. Form Filler  ");
  await page.fill("#crole", "Utilization review nurse");
  await page.check("#agree1"); await page.check("#agree2");
  await page.click("#cgo");
  await shows(page, "main", /Welcome, Dr\. Form Filler\n/);
});
for (const [what, setup, why] of [
  ["no name", async page => { await page.fill("#cname", ""); await page.check("#agree1"); await page.check("#agree2"); }, /please enter the name to credit/],
  ["no boxes ticked", async () => {}, /both boxes need to be ticked/],
  ["only the first box", async page => { await page.check("#agree1"); }, /both boxes need to be ticked/],
  ["only the second box", async page => { await page.check("#agree2"); }, /both boxes need to be ticked/],
]) {
  negative(`the welcome page with ${what}: a plain message, and the person stays on the welcome page`, async open => {
    const p = await invited();
    const page = await labelerPage(open, p.link, { agree: false });
    await setup(page);
    await storesNothing(async () => {
      await page.click("#cgo");
      await shows(page, "#cerr", why);
    });
    assert.ok(await page.isVisible("#cgo"));
  });
}
negative("the welcome page's boxes stop at their limits: name 100, role 150 characters", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link, { agree: false });
  await page.fill("#cname", "n".repeat(130));
  await page.fill("#crole", "r".repeat(180));
  assert.equal((await page.inputValue("#cname")).length, 100);
  assert.equal((await page.inputValue("#crole")).length, 150);
});

// ---- The training checkbox ---------------------------------------------------------------------------------------------

positive("ticking \"I've done the training\" shows the date; unticking takes it away", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await page.check("#trained");
  await shows(page, "main", /I've done the training \(/);
  await page.uncheck("#trained");
  await until(async () => !/I've done the training \(/.test(await text(page, "main")), "the date to go");
  assert.equal((await ownerApi("/api/admin/state")).labelers.find(l => l.id === p.id).training_done_at, null);
});

// ---- The case form ------------------------------------------------------------------------------------------------------

positive("the case form: four answers and a routing say Complete, and Submit is on", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await openCase(page, "practice_a");
  for (const k of CRITS) await pick(page, k, "undeterminable");
  await page.check("#formcol input[name=routing][value=route]");
  await shows(page, "#state", /^Complete\. Saved/);
  assert.ok(await page.isEnabled("#submit"));
});
negative("the case form with one criterion unanswered: Not complete, and Submit is off and greyed out", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await openCase(page, "practice_a");
  for (const k of CRITS.slice(0, 3)) await pick(page, k, "supported");
  await page.check("#formcol input[name=routing][value=approve]");
  await settled(page);
  assert.match(await text(page, "#state"), /Not complete yet/);
  assert.ok(await looksOff(page, "#submit"));
});
for (const [what, crit, gap] of [["a gap of only spaces", "C2", "      "], ["no gap criterion", "", "the therapy notes"], ["no gap text", "C2", ""]]) {
  negative(`the case form, a request with ${what}: Not complete, and Submit is off`, async open => {
    const p = await invited();
    const page = await labelerPage(open, p.link);
    await openCase(page, "practice_a");
    for (const k of CRITS) await pick(page, k, "supported");
    await page.check("#formcol input[name=routing][value=request]");
    if (crit) await page.selectOption("#gapc", crit);
    if (gap) await page.fill("#gapm", gap);
    await settled(page);
    assert.match(await text(page, "#state"), /Not complete yet/);
    assert.ok(await looksOff(page, "#submit"));
  });
}
negative("the gap box stops at 500 characters", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await openCase(page, "practice_a");
  await page.check("#formcol input[name=routing][value=request]");
  await page.fill("#gapm", "g".repeat(560));
  assert.equal((await page.inputValue("#gapm")).length, 500);
});
negative("Cancel on the Submit question submits nothing", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await openCase(page, "practice_a");
  for (const k of CRITS) await pick(page, k, "supported");
  await page.check("#formcol input[name=routing][value=approve]");
  await settled(page);
  await storesNothing(async () => {
    await page.click("#submit");
    await page.click("#mcancel");
  });
  assert.ok(await page.isEnabled("#submit"), "the case is still open");
});
negative("a submitted case's answers can't be changed from the form", async open => {
  const p = await invited();
  const page = await labelerPage(open, p.link);
  await openCase(page, "practice_a");
  for (const k of CRITS) await pick(page, k, "supported");
  await page.check("#formcol input[name=routing][value=approve]");
  await settled(page);
  await page.click("#submit"); await page.click("#mok");
  await shows(page, "#formcol", /This case is locked\./);
  await storesNothing(async () => {
    await page.locator("#formcol input[name=C1_red_flag][value=unsupported]").click({ force: true });
    await page.locator("#formcol input[name=routing][value=route]").click({ force: true });
  });
  assert.ok(await page.isChecked("#formcol input[name=C1_red_flag][value=supported]"), "the answer shown is still the submitted one");
});
