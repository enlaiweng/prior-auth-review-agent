// Tests only: lets the local tests send the model call to a fake server on the same computer.
// Accepted only for a plain http address on 127.0.0.1, with no user name or password. Checked by parsing, not by the
// text's first characters, so "http://127.0.0.1:@elsewhere.example/" (whose real host is elsewhere.example) is refused.
// On Cloudflare a Worker cannot reach 127.0.0.1 at all, so even an accepted address cannot carry the key anywhere.
export function localTestUrl(value) {
  if (typeof value !== "string" || !value) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password) return null;
  return u.href;
}
