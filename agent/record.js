// The agent's input step (docs/ARCHITECTURE.md, ADR-10 (2)): decode the visit note, split it into numbered paragraphs
// exactly as eval/tools/build_case_pages.py does, list the ids that may be cited, and write the case message.
// The rest of the record reaches the model unchanged, demographics included, so the fairness pairs test what they
// are meant to. Runs in Node.js and in a Cloudflare Worker: no Node-only modules.

// Paragraphs as build_case_pages.py splits them: strip the note, split on a blank line (a newline, optional
// whitespace, a newline), strip each piece, drop empty ones. Numbered note:p1 onward.
export function noteParagraphs(noteText) {
  return noteText.trim().split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

export function decodeBase64Utf8(data) {
  const bin = atob(data);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// Read a bundle into what the agent needs. Throws if the bundle lacks exactly one Claim, Patient, and DocumentReference.
export function readCase(bundle) {
  const resources = (bundle.entry || []).map(e => e.resource);
  const one = type => {
    const found = resources.filter(r => r.resourceType === type);
    if (found.length !== 1) throw new Error(`expected exactly one ${type} in the bundle, found ${found.length}`);
    return found[0];
  };
  const claim = one("Claim"), patient = one("Patient"), doc = one("DocumentReference");
  const noteText = decodeBase64Utf8(doc.content[0].attachment.data);
  const paragraphs = noteParagraphs(noteText).map((text, i) => ({ id: `note:p${i + 1}`, text }));
  const noteDocId = `DocumentReference/${doc.id}`;
  const resourceIds = resources.map(r => `${r.resourceType}/${r.id}`);
  return {
    claimId: `Claim/${claim.id}`,
    requestDate: String(claim.created || "").slice(0, 10),
    patientId: `Patient/${patient.id}`,
    noteDocId,
    noteDate: String(doc.date || "").slice(0, 10),
    paragraphs,
    citableIds: [...resourceIds, ...paragraphs.map(p => p.id)],
    noteIds: new Set([noteDocId, ...paragraphs.map(p => p.id)]),
    bundleForModel: withoutNoteText(bundle, doc.id, paragraphs.length),
  };
}

// A copy of the bundle with the note's encoded text replaced by a pointer to the numbered paragraphs.
function withoutNoteText(bundle, docId, n) {
  const copy = JSON.parse(JSON.stringify(bundle));
  for (const e of copy.entry) {
    const r = e.resource;
    if (r.resourceType === "DocumentReference" && r.id === docId) {
      for (const c of r.content) {
        if (c.attachment && "data" in c.attachment) {
          c.attachment.data = `(the note's text is given below as numbered paragraphs note:p1 to note:p${n})`;
        }
      }
    }
  }
  return copy;
}

export function caseMessage(rc) {
  const lines = [
    `Prior authorization request ${rc.claimId}, requested on ${rc.requestDate}.`,
    "",
    "Ids you may cite (copy them exactly):",
    rc.citableIds.join("\n"),
    "",
    "=== FHIR R4 BUNDLE, as submitted (the visit note's text is given below as numbered paragraphs) ===",
    JSON.stringify(rc.bundleForModel),
    "",
    `=== VISIT NOTE: ${rc.noteDocId}, dated ${rc.noteDate} ===`,
  ];
  for (const p of rc.paragraphs) lines.push("", `[${p.id}] ${p.text}`);
  return lines.join("\n");
}
