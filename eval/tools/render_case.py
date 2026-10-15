#!/usr/bin/env python3
"""Render a golden case (case_spec.yaml + note.md + patient baseline) into a FHIR R4 bundle.

Usage: python3 eval/tools/render_case.py data/golden/case_01
Writes data/golden/case_01/bundle.json (Bundle type "collection") containing:
  - the baseline resources unchanged (Patient plus allowlisted Conditions/MedicationRequests)
  - one Claim (use "preauthorization") naming the requested procedure by SNOMED concept and text
  - one Condition for the index condition (ICD-10-CM M54.5 family)
  - one Encounter per listed encounter (class AMB, or EMER when the spec says emergency)
  - one Procedure per therapy entry (performedPeriod; an ongoing course has a start date only)
    and per prior imaging entry (performedDateTime), plus a DiagnosticReport when the spec gives the report text
  - one MedicationRequest per medication entry (authoredOn, dosage period; completed if it ended before the request)
  - one Observation per listed observation: exam findings (LOINC 29545-1) by default, or the LOINC code,
    category and measured value the spec names (for example body weight, 29463-7, in kg)
  - one DocumentReference holding note.md (base64, text/plain), dated to the last encounter
Nothing in the bundle says what a finding means for the policy: findings are written as a chart writes them,
with no "red flag" wording and no style marker, so the record does not hint at an answer (Amendment 2).
Every resource id is <caseid>-<kind>-<nn> with the underscore removed, because FHIR ids allow only letters, digits, hyphen and dot (case01-pt-01, case01-med-01, case01-obs-01, case01-claim ...).
Validated with fhir.resources R4B models before writing. No network access.
"""
import base64, json, os, sys
import yaml
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.claim import Claim, ClaimItem
from fhir.resources.R4B.condition import Condition
from fhir.resources.R4B.encounter import Encounter
from fhir.resources.R4B.procedure import Procedure
from fhir.resources.R4B.medicationrequest import MedicationRequest
from fhir.resources.R4B.observation import Observation
from fhir.resources.R4B.documentreference import DocumentReference
from fhir.resources.R4B.diagnosticreport import DiagnosticReport

SNOMED = "http://snomed.info/sct"
ICD10CM = "http://hl7.org/fhir/sid/icd-10-cm"
LOINC = "http://loinc.org"

# text -> ICD-10-CM code for the index condition (M54.5 family after the FY2022 split).
# Checked in this order, most specific first, so "low back pain with radiculopathy" is coded as radiculopathy.
INDEX_CODES = {
    "radiculopathy": ("M54.16", "Radiculopathy, lumbar region"),
    "sciatica": ("M54.30", "Sciatica, unspecified side"),
    "low back pain": ("M54.50", "Low back pain, unspecified"),
}
# SNOMED CT codes below were checked on 2026-10-14 against public SNOMED CT browsers and the VSAC "MRI Low Back"
# value set (241648005), except 229065009 (Exercise therapy), which no case in version 1.0 uses.
THERAPY_KIND = {
    "physical therapy": ("91251008", "Physical therapy procedure"),
    "chiropractic": ("46947000", "Chiropractic manipulation"),
    "home exercise": ("229065009", "Exercise therapy"),
}
IMAGING_KIND = {
    "lumbar mri": ("241648005", "MRI of lumbar spine"),
    "lumbar ct": ("241580002", "CT of lumbar spine"),
    "lumbar x-ray": ("90805008", "Diagnostic radiography of lumbar spine"),
}
# Official SNOMED CT terms for codes a case spec may name as the requested procedure.
# The spec's own text (for example "MRI lumbar spine without contrast") goes in .text, not in the coding's display.
SNOMED_DISPLAY = {code: disp for code, disp in IMAGING_KIND.values()}
MED_KIND = {
    "nsaid": ("Ibuprofen 600 MG Oral Tablet",),
    "naproxen": ("Naproxen 500 MG Oral Tablet",),
    "acetaminophen": ("Acetaminophen 500 MG Oral Tablet",),
    "muscle relaxant": ("Cyclobenzaprine 10 MG Oral Tablet",),
    "ibuprofen": ("Ibuprofen 600 MG Oral Tablet",),
}
OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
UCUM = "http://unitsofmeasure.org"
PRIORITY = {"normal": "Normal", "stat": "Immediate"}  # processpriority codes; "stat" marks an expedited request

# A spec holds facts only (Amendment 2). Any other key, for example a scenario line, a note style, a planned
# decision, or a list of red flags, says what the case is meant to test, so the renderer refuses it.
ALLOWED = {
    "": {"case_id", "patient_baseline", "request_date", "requested_procedure", "episode", "note"},
    "requested_procedure": {"text", "snomed", "priority"},
    "episode": {"index_condition", "encounters", "conservative_therapy", "prior_imaging", "observations", "past_history"},
    "note": {"file"},
}


def check_spec(spec):
    for where, allowed in ALLOWED.items():
        block = spec if where == "" else (spec.get(where) or {})
        extra = set(block) - allowed
        if extra:
            sys.exit(f"case_spec.yaml: {', '.join(sorted(extra))} not allowed{' under ' + where if where else ''}; "
                     f"a spec holds facts only (allowed: {', '.join(sorted(allowed))})")



def cc(system, code, display):
    return {"coding": [{"system": system, "code": code, "display": display}], "text": display}


def pick(mapping, text):
    """Return the entry for the first key found in text. Stop with an error when none matches, rather than guess."""
    t = text.lower()
    for k, v in mapping.items():
        if k in t:
            return v
    sys.exit(f"case_spec.yaml: '{text}' matches none of: {', '.join(mapping)}")


def main(case_dir):
    spec = yaml.safe_load(open(os.path.join(case_dir, "case_spec.yaml")))
    check_spec(spec)
    cid = spec["case_id"].replace("_", "")  # FHIR ids allow only letters, digits, hyphen, dot
    baseline = json.load(open(spec["patient_baseline"]))
    patient = next(r for r in baseline if r["resourceType"] == "Patient")
    pref = {"reference": f"urn:uuid:{patient['id']}"}  # matches the Patient entry's fullUrl exactly
    ep = spec["episode"]
    req_date = str(spec["request_date"])
    ids, resources = [], []

    def add(res):
        resources.append(res.dict(exclude_none=True) if hasattr(res, "dict") else res)
        ids.append(f"{resources[-1]['resourceType']}/{resources[-1]['id']}")

    # Claim: the prior authorization request itself
    proc = spec["requested_procedure"]
    claim = Claim(
        id=f"{cid}-claim", status="active",
        type=cc("http://terminology.hl7.org/CodeSystem/claim-type", "professional", "Professional"),
        use="preauthorization", patient=pref, created=req_date,
        provider={"display": "Ordering provider (synthetic)"},
        priority=cc("http://terminology.hl7.org/CodeSystem/processpriority", proc.get("priority", "normal"),
                    PRIORITY[proc.get("priority", "normal")]),
        insurance=[{"sequence": 1, "focal": True, "coverage": {"display": "Medicare Advantage plan (synthetic)"}}],
        item=[ClaimItem(sequence=1, productOrService={
            "coding": [{"system": SNOMED, "code": str(proc["snomed"]),
                        "display": SNOMED_DISPLAY.get(str(proc["snomed"]), proc["text"])}],
            "text": proc["text"]})],
    )
    add(claim)

    # Index condition
    code, disp = pick(INDEX_CODES, ep["index_condition"]["code_text"])
    add(Condition(
        id=f"{cid}-cond-01",
        clinicalStatus=cc("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active"),
        verificationStatus=cc("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed"),
        code={"coding": [{"system": ICD10CM, "code": code, "display": disp}], "text": ep["index_condition"]["code_text"]},
        subject=pref, onsetDateTime=str(ep["index_condition"]["onset_date"]),
    ))

    # Encounters
    enc_ids = []
    for i, e in enumerate(ep.get("encounters", []), 1):
        eid = f"{cid}-enc-{i:02d}"
        enc_ids.append(eid)
        cls = ("EMER", "emergency") if "emerg" in str(e.get("class", "")).lower() else ("AMB", "ambulatory")
        add(Encounter(
            id=eid, status="finished",
            **{"class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": cls[0], "display": cls[1]}},
            type=[{"text": e["type"]}], subject=pref,
            period={"start": str(e["date"]), "end": str(e["date"])},
            reasonCode=[{"text": e.get("summary", "")}] if e.get("summary") else None,
        ))

    # Conservative therapy: procedures and medications
    pt_n = med_n = 0
    for th in ep.get("conservative_therapy", []):
        kind = th["kind"].lower()
        if kind in THERAPY_KIND or "therapy" in kind or "chiropractic" in kind or "exercise" in kind:
            pt_n += 1
            scode, sdisp = pick(THERAPY_KIND, kind)
            ongoing = bool(th.get("ongoing"))
            period = {"start": str(th["start"])} if ongoing else {"start": str(th["start"]), "end": str(th["end"])}
            sessions = f"{th['sessions']} sessions" + (" to date" if ongoing else "") if th.get("sessions") else None
            add(Procedure(
                id=f"{cid}-pt-{pt_n:02d}", status="in-progress" if ongoing else "completed",
                code=cc(SNOMED, scode, sdisp), subject=pref,
                performedPeriod=period,
                note=[{"text": sessions}] if sessions else None,
            ))
        else:
            med_n += 1
            (mdisp,) = pick(MED_KIND, kind)
            ongoing = bool(th.get("ongoing"))
            bounds = {"start": str(th["start"])} if ongoing else {"start": str(th["start"]), "end": str(th["end"])}
            ended = (not ongoing) and str(th["end"]) < req_date
            add(MedicationRequest(
                id=f"{cid}-med-{med_n:02d}", status="completed" if ended else "active", intent="order",
                medicationCodeableConcept={"text": mdisp}, subject=pref,
                authoredOn=str(th["start"]),
                dosageInstruction=[{"text": f"{mdisp}, from {th['start']}" + ("" if ongoing else f" to {th['end']}"),
                                    "timing": {"repeat": {"boundsPeriod": bounds}}}],
            ))

    # Prior imaging
    img_n = 0
    for im in ep.get("prior_imaging", []) or []:
        img_n += 1
        scode, sdisp = pick(IMAGING_KIND, im["kind"])
        add(Procedure(
            id=f"{cid}-img-{img_n:02d}", status="completed", code=cc(SNOMED, scode, sdisp),
            subject=pref, performedDateTime=str(im["date"]),
        ))
        if im.get("report"):
            add(DiagnosticReport(
                id=f"{cid}-dr-{img_n:02d}", status="final",
                code={"text": f"{sdisp} report"}, subject=pref,
                effectiveDateTime=str(im["date"]), conclusion=im["report"],
            ))

    # Past history recorded in the chart before this episode: conditions (ICD-10-CM when given) and procedures.
    cond_n, proc_n = 1, 0
    for h in ep.get("past_history", []) or []:
        if h["kind"] == "condition":
            cond_n += 1
            coding = [{"system": ICD10CM, "code": h["icd10"], "display": h["icd10_display"]}] if h.get("icd10") else []
            status = h.get("status", "active")
            add(Condition(
                id=f"{cid}-cond-{cond_n:02d}",
                clinicalStatus=cc("http://terminology.hl7.org/CodeSystem/condition-clinical", status, status.capitalize()),
                verificationStatus=cc("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed"),
                code={"coding": coding, "text": h["text"]} if coding else {"text": h["text"]},
                subject=pref, onsetDateTime=str(h["date"]),
                abatementDateTime=str(h["resolved"]) if h.get("resolved") else None,
            ))
        elif h["kind"] == "procedure":
            proc_n += 1
            add(Procedure(id=f"{cid}-proc-{proc_n:02d}", status="completed", code={"text": h["text"]},
                          subject=pref, performedDateTime=str(h["date"])))
        else:
            sys.exit(f"case_spec.yaml: past_history kind must be condition or procedure, not {h['kind']}")

    # Observations, written as a chart writes them, with no label saying what a finding means for the policy.
    obs_n = 0
    for o in ep.get("observations", []) or []:
        obs_n += 1
        code = str(o.get("loinc", "29545-1"))
        display = o.get("display", "Physical findings Narrative" if code == "29545-1" else code)
        category = o.get("category", "exam")
        obs = dict(
            id=f"{cid}-obs-{obs_n:02d}", status="final",
            code={"coding": [{"system": LOINC, "code": code, "display": display}], "text": display},
            subject=pref, effectiveDateTime=str(o.get("date") or req_date),
        )
        if category:
            obs["category"] = [cc(OBS_CATEGORY, category, {"exam": "Exam", "vital-signs": "Vital Signs"}.get(category, category))]
        if o.get("value") is not None:
            obs["valueQuantity"] = {"value": o["value"], "unit": o["unit"], "system": UCUM, "code": o["unit"]}
        else:
            obs["valueString"] = o["text"]
        add(Observation(**obs))

    # Note as DocumentReference
    note_text = open(os.path.join(case_dir, spec["note"]["file"])).read()
    last_enc = str(ep["encounters"][-1]["date"]) if ep.get("encounters") else req_date
    add(DocumentReference(
        id=f"{cid}-note-01", status="current",
        type=cc(LOINC, "11506-3", "Progress note"), subject=pref, date=f"{last_enc}T12:00:00+00:00",
        description="Visit note",  # no style marker, so held-out cases cannot be told apart (Amendment 2)
        content=[{"attachment": {"contentType": "text/plain", "data": base64.b64encode(note_text.encode()).decode(),
                                 "title": "note.md"}}],
    ))

    # Baseline resources keep Synthea's urn:uuid addresses (their own references use them).
    # Authored resources get an absolute address, as FHIR requires; labels still cite them as Type/id.
    entries = [BundleEntry(fullUrl=f"urn:uuid:{r['id']}", resource=r) for r in baseline] + \
              [BundleEntry(fullUrl=f"http://example.org/fhir/{r['resourceType']}/{r['id']}", resource=r) for r in resources]
    bundle = Bundle(id=f"{cid}-bundle", type="collection", timestamp=f"{req_date}T12:00:00+00:00", entry=entries)
    out = os.path.join(case_dir, "bundle.json")
    with open(out, "w") as f:
        f.write(bundle.json(indent=1, exclude_none=True))
    print(f"wrote {out} with {len(entries)} resources")
    for i in ids:
        print(" ", i)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    main(sys.argv[1])
