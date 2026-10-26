// End-to-end scenarios: a visitor's real journeys through the demo in a real browser (Chromium through Playwright),
// against the real Worker in Cloudflare's local runtime and a fake model. They add to viewer.test.mjs.
//   CHROMIUM_PATH=<file>  uses that Chromium instead of the one `npx playwright install chromium` downloads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { build, startFakeModel, startDemo, PASSCODE, ROOT, finalLabels, reportFrom } from "./local-demo.mjs";

const ALL = Array.from({ length: 12 }, (_, i) => "case_" + String(i + 1).padStart(2, "0"));
const LIVE = ["case_01", "case_02", "case_03"];
const HELD = ["case_08", "case_10", "case_12"];
let browser, fake;
before(async () => {
  build();
  fake = await startFakeModel();
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); fake?.stop(); });

const namedGap = id => {
  const m = readFileSync(join(ROOT, "data/golden", id, "labels.yaml"), "utf8").match(/^named_gap: \{criterion: (C\d), missing: "([^"]+)"\}/m);
  return m ? { criterion: m[1], missing: m[2] } : null;
};
const goodReport = id => reportFrom(finalLabels(id), { missing: namedGap(id) });

async function withDemo(vars, fn) {
  const d = await startDemo({ AGENT_TEST_API_URL: fake.url, LIVE_PER_MINUTE: "50", LIVE_PER_DAY: "500", ...vars });
  try { await fn(d); } finally { d.stop(); }
}
// Opens the viewer as a new visitor. `problems` collects script errors and blocked content; `requests` every address
// the page asked for.
async function visit(base, path = "/", { viewport = { width: 1280, height: 900 }, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  const problems = [], requests = [];
  page.on("console", m => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", e => problems.push(String(e)));
  page.on("request", r => requests.push(r.url()));
  await page.goto(base + path);
  await page.waitForSelector(".cases button");
  await page.waitForSelector("#main h2");
  return { ctx, page, problems, requests };
}
const heading = page => page.locator("#main h2").innerText();
const openCase = async (page, id) => {
  await page.click(`.cases button[data-case="${id}"]`);
  await page.waitForFunction(n => document.querySelector("#main h2")?.innerText === n, "Case " + id.slice(5));
};
const runLive = async (page, passcode = PASSCODE) => {
  await page.fill("#pc", passcode);
  await page.click("#run");
};
// Waits for a live result; if none comes, says what the page shows instead.
const waitResult = page => page.waitForSelector("#liveresult .badge", { timeout: 30000 }).catch(async e => {
  const seen = await page.evaluate(() => `state "${document.getElementById("livestate")?.innerText}", ${document.querySelector("#main h2")?.innerText}, address ${location.hash}`);
  throw new Error("no live result appeared: " + seen);
});
const waitState = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.getElementById("livestate")?.innerText || ""), re.source, { timeout: 30000 });
// Expected browser log lines for refused requests (the browser logs any 4xx as a failed load).
const onlyRefusals = problems => problems.filter(p => !/status of (403|429)/.test(p));

test("1. first visit: twelve cases, the mode, the version, nothing loaded from anywhere else", async () => {
  await withDemo({}, async d => {
    const { ctx, page, problems, requests } = await visit(d.base);
    assert.match(await page.locator("#mode").innerText(), /^Checklist mode/);
    const subs = await page.locator(".cases button .sub").allInnerTexts();
    const names = await page.locator(".cases button").evaluateAll(bs => bs.map(b => b.dataset.case));
    assert.deepEqual(names, ALL);
    names.forEach((id, i) => {
      const want = LIVE.includes(id) ? "Can run live" : HELD.includes(id) ? "Held out" : "Not live yet";
      assert.equal(subs[i], want, id);
    });
    assert.equal(await heading(page), "Case 01");
    assert.match(await page.locator("footer").innerText(), /Agent agent-[\d.]+ \(spec [0-9a-f]{12}\).*Live runs used today: 0 of 500\./s);
    assert.ok(requests.every(u => u.startsWith(d.base) || u.startsWith("data:")), "only the demo's own address: " + requests.filter(u => !u.startsWith(d.base)).join(" "));
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("2. browsing every case: the right heading, record, address and live-run panel for each", async () => {
  await withDemo({}, async d => {
    const { ctx, page, problems } = await visit(d.base);
    for (const id of [...ALL].reverse()) {
      await openCase(page, id);
      assert.ok(page.url().endsWith("#" + id), id + ": the address names the case");
      assert.equal(await page.locator(`.cases button[data-case="${id}"]`).getAttribute("aria-current"), "true");
      assert.equal(await page.locator('.cases button[aria-current="true"]').count(), 1);
      assert.ok(await page.locator(`#rec-Claim_case${id.slice(5)}-claim`).count(), id + ": its record is shown");
      const card = await page.locator("#livecard").innerText();
      if (LIVE.includes(id)) assert.equal(await page.locator("#pc").count(), 1, id + ": a passcode box");
      else {
        assert.equal(await page.locator("#pc").count(), 0, id + ": no passcode box");
        assert.match(card, HELD.includes(id) ? /held-out/ : /isn't settled yet|outside clinician|Until the first full run/, id);
      }
      if (HELD.includes(id)) assert.match(await page.locator("#main .lead").first().innerText(), /held-out case/);
    }
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("3. shared links open the named case; a broken link falls back to case 01 without an error", async () => {
  await withDemo({}, async d => {
    for (const id of ALL) {
      const { ctx, page } = await visit(d.base, "/#" + id);
      assert.equal(await heading(page), "Case " + id.slice(5), id);
      await ctx.close();
    }
    for (const hash of ["#case_99", "#case_1", "#%3Cscript%3Ealert(1)%3C/script%3E", "#", "#../api/status"]) {
      const { ctx, page, problems } = await visit(d.base, "/" + hash);
      assert.equal(await heading(page), "Case 01", hash);
      assert.deepEqual(problems, [], hash);
      await ctx.close();
    }
  });
});

test("4. the browser's back button and a link pasted into an open tab move between cases", async () => {
  await withDemo({}, async d => {
    const { ctx, page, problems } = await visit(d.base);
    await openCase(page, "case_02");
    await openCase(page, "case_03");
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("#main h2")?.innerText === "Case 02", null, { timeout: 5000 });
    await page.evaluate(() => { location.hash = "#case_06"; });
    await page.waitForFunction(() => document.querySelector("#main h2")?.innerText === "Case 06", null, { timeout: 5000 });
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("5. live runs on each live case in checklist mode, with the day's count going up", async () => {
  await withDemo({}, async d => {
    const { ctx, page, problems } = await visit(d.base);
    for (const [i, id] of LIVE.entries()) {
      fake.reply = () => ({ report: goodReport(id) });
      await openCase(page, id);
      await runLive(page);
      await waitResult(page);
      const out = await page.locator("#liveresult").innerText();
      assert.match(out, /Send to physician review/, id);
      assert.match(out, /Checklist mode is on/, id);
      assert.equal(await page.locator("#liveresult .crit").count(), 4, id);
      assert.doesNotMatch(out, /\bden(y|ied|ial)\b/i);
      await page.waitForFunction(n => document.querySelector("footer").innerText.includes("Live runs used today: " + n + " of"), i + 1);
    }
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("6. with approvals on: approve, request one document, and physician review, each shown in plain words", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async d => {
    const { ctx, page, problems } = await visit(d.base);
    assert.match(await page.locator("#mode").innerText(), /^Approvals are on/);
    const want = { case_01: /Approve[\s\S]*The approval rests on C2/, case_02: /Send to physician review/, case_03: /Request one document[\s\S]*Document requested for C2: dates, duration/ };
    for (const id of LIVE) {
      fake.reply = () => ({ report: goodReport(id) });
      await openCase(page, id);
      await runLive(page);
      await waitResult(page);
      assert.match(await page.locator("#liveresult").innerText(), want[id], id);
    }
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("7. wrong passcodes: a clear message each time, then a pause after five, and the model is never called", async () => {
  await withDemo({}, async d => {
    fake.calls.length = 0;
    const { ctx, page, problems } = await visit(d.base);
    for (let i = 0; i < 5; i++) {
      await runLive(page, "wrong-passcode-" + i);
      await waitState(page, /isn't right/);
      await page.evaluate(() => { document.getElementById("livestate").textContent = ""; });
    }
    await runLive(page, PASSCODE);
    await waitState(page, /Too many wrong passcodes/);
    assert.equal(await page.locator("#liveresult .badge").count(), 0);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(onlyRefusals(problems), []);
    await ctx.close();
  });
});

test("8. the per-minute limit and an unset-up demo explain themselves", async () => {
  await withDemo({ LIVE_PER_MINUTE: "1" }, async d => {
    fake.reply = () => ({ report: goodReport("case_01") });
    const { ctx, page, problems } = await visit(d.base);
    await runLive(page); await waitResult(page);
    await openCase(page, "case_02");
    await runLive(page);
    await waitState(page, /limited to 1 a minute/);
    assert.deepEqual(onlyRefusals(problems), []);
    await ctx.close();
  });
  await withDemo({ ANTHROPIC_API_KEY: null }, async d => {
    const { ctx, page } = await visit(d.base);
    assert.match(await page.locator("#livecard").innerText(), /aren't set up/);
    assert.equal(await page.locator("#pc").count(), 0);
    await ctx.close();
  });
});

test("9. a failing model and a slow one: the error is shown and routed; the wait shows progress", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async d => {
    const { ctx, page, problems } = await visit(d.base);
    fake.reply = () => ({ status: 400, body: { error: { message: "fake bad request" } } });
    await runLive(page); await waitResult(page);
    let out = await page.locator("#liveresult").innerText();
    assert.match(out, /Send to physician review/);
    assert.match(out, /couldn't be used: .*HTTP 400: fake bad request/);

    fake.reply = () => ({ delayMs: 3500, report: goodReport("case_01") });
    await runLive(page);
    await waitState(page, /reading the record… [2-9] s/);
    assert.equal(await page.locator("#run").isDisabled(), true, "the button is off while the run is going");
    await waitResult(page);
    assert.match(await page.locator("#liveresult").innerText(), /Approve/);
    assert.match(await page.locator("#livestate").innerText(), /Done in \d+ s/);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("10. pressing Enter twice, or clicking twice, starts only one run", async () => {
  await withDemo({}, async d => {
    const { ctx, page } = await visit(d.base);
    fake.reply = () => ({ delayMs: 1500, report: goodReport("case_01") });
    fake.calls.length = 0;
    await page.fill("#pc", PASSCODE);
    await page.press("#pc", "Enter");
    await page.press("#pc", "Enter");
    await page.click("#run", { force: true }).catch(() => {});
    await waitResult(page);
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(fake.calls.length, 1, "one run, not several");
    await ctx.close();
  });
});

test("11. moving to another case during a run: no result lands on the wrong case, and it's there on return", async () => {
  await withDemo({}, async d => {
    const { ctx, page, problems } = await visit(d.base);
    fake.reply = () => ({ delayMs: 3000, report: goodReport("case_01") });
    fake.calls.length = 0;
    await runLive(page);
    await openCase(page, "case_02");
    assert.equal(await page.locator("#liveresult .badge").count(), 0);
    assert.equal(await page.locator("#run").isDisabled(), true, "one run at a time");
    await openCase(page, "case_01");          // back while it's still running
    await waitResult(page);
    assert.match(await page.locator("#liveresult").innerText(), /Live run, just now/);
    await openCase(page, "case_02");
    assert.equal(await page.locator("#liveresult .badge").count(), 0, "case 02 still shows nothing");
    assert.equal(await page.locator("#run").isDisabled(), false, "and can be run now");
    await openCase(page, "case_01");
    assert.equal(await page.locator("#liveresult .badge").count(), 1, "case 01 keeps its result");
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("12. keyboard only: reach a case, open it, type the passcode and run, with focus always visible", async () => {
  await withDemo({}, async d => {
    fake.reply = () => ({ report: goodReport("case_02") });
    const { ctx, page } = await visit(d.base);
    const tabTo = async (test, label) => {
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(test)) return;
      }
      assert.fail("couldn't reach " + label + " with Tab");
    };
    await tabTo(() => document.activeElement?.dataset?.case === "case_02", "case 02");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(outline, "none", "the focused button shows a focus ring");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#main h2")?.innerText === "Case 02");
    assert.equal(await page.evaluate(() => document.activeElement.id), "main", "focus moves to the case");
    await tabTo(() => document.activeElement?.id === "pc", "the passcode box");
    await page.keyboard.type(PASSCODE);
    await page.keyboard.press("Enter");
    await waitResult(page);
    await ctx.close();
  });
});

test("13. on a phone, every case and a live result fit the screen", async () => {
  await withDemo({}, async d => {
    fake.reply = () => ({ report: goodReport("case_03") });
    const { ctx, page, problems } = await visit(d.base, "/", { viewport: { width: 360, height: 740 } });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const id of ALL) { await openCase(page, id); assert.ok(await overflow() <= 0, id + ": wider than the screen by " + await overflow() + "px"); }
    await openCase(page, "case_03");
    await runLive(page); await waitResult(page);
    assert.ok(await overflow() <= 0, "the live result is wider than the screen");
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});

test("14. readable in light and dark mode: text contrast of at least 4.5 to 1 everywhere it matters", async () => {
  await withDemo({ CHECKLIST_MODE: "false" }, async d => {
    for (const colorScheme of ["light", "dark"]) {
      fake.reply = () => ({ report: goodReport("case_03") });
      const { ctx, page, problems } = await visit(d.base, "/#case_03", { colorScheme });
      await runLive(page); await waitResult(page);
      const low = await page.evaluate(() => {
        const rgb = s => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return rgb(getComputedStyle(document.documentElement).backgroundColor || "rgb(255,255,255)"); };
        const out = [];
        for (const el of document.querySelectorAll("h1, h2, h3, p, li, span, button, code, input, label:not(.sr)")) {
          if (!el.offsetParent && el.tagName !== "BODY") continue;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (!own && el.tagName !== "INPUT") continue;
          const fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < 4.5) out.push(`${el.tagName}.${el.className} "${(el.innerText || el.value || el.placeholder || "").slice(0, 30)}" ${ratio.toFixed(2)}`);
        }
        return [...new Set(out)];
      });
      assert.deepEqual(low, [], colorScheme + ": low-contrast text");
      assert.deepEqual(problems, []);
      await ctx.close();
    }
  });
});

test("15. the passcode stays private: hidden as typed, never in the address, storage, or cookies", async () => {
  await withDemo({}, async d => {
    fake.reply = () => ({ report: goodReport("case_01") });
    const { ctx, page } = await visit(d.base);
    assert.equal(await page.locator("#pc").getAttribute("type"), "password");
    assert.equal(await page.locator("#pc").getAttribute("autocomplete"), "off");
    await runLive(page); await waitResult(page);
    assert.ok(!page.url().includes(PASSCODE));
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }));
    assert.ok(!stored.includes(PASSCODE), stored);
    assert.equal((await ctx.cookies()).length, 0, "the demo sets no cookies");
    await ctx.close();
  });
});

test("16. another site can't show the demo inside its own page", async () => {
  await withDemo({}, async d => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<iframe id="f" src="${d.base}/" width="800" height="600"></iframe>`);
    await new Promise(r => setTimeout(r, 2500));
    const frame = page.frames().find(f => f !== page.mainFrame());
    const text = frame ? await frame.evaluate(() => document.body ? document.body.innerText : "").catch(() => "") : "";
    assert.doesNotMatch(text, /Prior authorization review agent/, "the demo loaded inside another page");
    await ctx.close();
  });
});

test("17. stored decisions: shown under the current mode, never for held-out cases, with the run named", async () => {
  const { reviewCase, AGENT_VERSION } = await import("../../agent/agent.js");
  const { SPEC_SHA256 } = await import("../../agent/spec.generated.js");
  const dir = `eval/runs/demo-test-scenario-${process.pid}`;
  mkdirSync(join(ROOT, dir), { recursive: true });
  try {
    const bundle = id => JSON.parse(readFileSync(join(ROOT, "data/golden", id, "bundle.json"), "utf8"));
    const answer = report => async () => new Response(JSON.stringify({ model: "fake", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(report) }], usage: {} }));
    const cases = {};
    for (const id of ["case_01", "case_02", "case_03", "case_08"]) {
      const dd = await reviewCase(bundle(id), { apiKey: "k", caseId: id, fetchImpl: answer(goodReport(id)), sleep: async () => {} });
      writeFileSync(join(ROOT, dir, id + ".json"), JSON.stringify(dd));
      cases[id] = {};
    }
    writeFileSync(join(ROOT, dir, "run.json"), JSON.stringify({ agent_version: AGENT_VERSION, spec_sha256: SPEC_SHA256, case_set: "all12", budget: "release",
      started_utc: "2026-11-01T18:00:00Z", finished_utc: "2026-11-01T18:20:00Z", cases }));
    build(["--stored-run", dir]);
    for (const [mode, sub01, want03] of [[null, "Send to physician review", /Send to physician review/], ["false", "Approve", /Request one document/]]) {
      await withDemo({ CHECKLIST_MODE: mode }, async d => {
        const { ctx, page, problems } = await visit(d.base);
        assert.equal(await page.locator('.cases button[data-case="case_01"] .sub').innerText(), sub01, "mode " + mode);
        assert.equal(await page.locator('.cases button[data-case="case_08"] .sub').innerText(), "Held out", "no stored outcome for a held-out case");
        assert.match(await page.locator("#main").innerText(), /The agent's decision \(stored from the evaluation run\)/);
        await openCase(page, "case_03");
        assert.match(await page.locator("#main .card").first().innerText(), want03);
        await openCase(page, "case_08");
        assert.match(await page.locator("#main").innerText(), /No stored decision yet/);
        assert.match(await page.locator("footer").innerText(), /Stored decisions from the run started 2026-11-01T18:00:00Z/);
        assert.deepEqual(problems, []);
        await ctx.close();
      });
    }
  } finally {
    rmSync(join(ROOT, dir), { recursive: true, force: true });
    build();
  }
});

test("18. if the demo stops answering mid-visit, the page says so in plain words", async () => {
  const d = await startDemo({ AGENT_TEST_API_URL: fake.url });
  let ctx;
  try {
    const v = await visit(d.base);
    ctx = v.ctx;
    d.stop();
    await new Promise(r => setTimeout(r, 1500));
    await v.page.click('.cases button[data-case="case_02"]');
    await v.page.waitForSelector("#main .err", { timeout: 10000 });
    assert.match(await v.page.locator("#main .err").innerText(), /can't be reached/);
  } finally { await ctx?.close(); d.stop(); }
});
