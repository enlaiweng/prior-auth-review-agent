// Starts the labeling site on this computer for the tests: the real Worker code in Cloudflare's local runtime
// (wrangler dev --local) with an empty local database in a temporary folder. Nothing touches Cloudflare.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";

// Every request the tests send opens its own connection. Reusing an idle connection lets a request race the local
// server closing it ("fetch failed: other side closed"), a test-only failure that shows up when the machine is busy.
setGlobalDispatcher(new Agent({ pipelining: 0 }));

export const SITE = dirname(dirname(fileURLToPath(import.meta.url)));
export const ADMIN_KEY = "test-admin-key-0123456789-abcdefghij";
export const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

// adminKey: the ADMIN_KEY the site runs with; null starts it with none, as if the deploy never set one.
export async function startSite({ adminKey = ADMIN_KEY } = {}) {
  const port = 18700 + Math.floor(Math.random() * 1000);
  const persist = mkdtempSync(join(tmpdir(), "labeling-site-"));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "prior-auth-labeling", "--local", "--persist-to", persist],
    { cwd: SITE, env: ENV, stdio: "ignore" });
  const args = ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persist];
  if (adminKey !== null) args.push("--var", `ADMIN_KEY:${adminKey}`);
  const dev = spawn("npx", args, { cwd: SITE, env: ENV, stdio: "ignore", detached: true });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try { process.kill(-dev.pid); } catch (e) {}
    rmSync(persist, { recursive: true, force: true });
  };
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + "/")).ok) return { base, port, persist, stop }; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  stop();
  throw new Error("the local Worker did not start");
}
