#!/usr/bin/env python3
"""Render a golden case (case_spec.yaml + note.md + patient baseline) into a FHIR R4 bundle.

Usage: python3 eval/tools/render_case.py data/golden/case_01
Writes data/golden/case_01/bundle.json (Bundle type "collection") containing:
  - the baseline resources unchanged (Patient plus allowlisted Conditions/MedicationRequests)
  - one Claim (use "preauthorization") naming the requested procedure by SNOMED concept and text
  - one Condition for the index condition (ICD-10-CM M54.5 family)
  - one Encounter per listed encounter
  - one Procedure per physical therapy or prior imaging entry (performedPeriod)
  - one MedicationRequest per medication entry (authoredOn, dosage period)
  - one Observation per listed observation and per structured red flag
  - one DocumentReference holding note.md (base64, text/plain), dated to the last encounter
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

SNOMED = "http://snomed.info/sct"
ICD10CM = "http://hl7.org/fhir/sid/icd-10-cm"
LOINC = "http://loinc.org"

# text -> ICD-10-CM code for the index condition (M54.5 family after the FY2022 split)
INDEX_CODES = {
    "low back pain": ("M54.50", "Low back pain, unspecified"),
    "radiculopathy": ("M54.16", "Radiculopathy, lumbar region"),
    "sciatica": ("M54.30", "Sciatica, unspecified side"),
}
THERAPY_KIND = {
    "physical therapy": ("91251008", "Physical therapy procedure"),
    "chiropractic": ("44868003", "Chiropractic manipulation"),
    "home exercise": ("229065009", "Exercise therapy"),
}
IMAGING_KIND = {
    "lumbar mri": ("241645004", "MRI of lumbar spine"),
    "lumbar ct": ("241593005", "CT of lumbar spine"),
    "lumbar x-ray": ("241093004", "Plain X-ray of lumbar spine"),
}
MED_KIND = {
    "nsaid": ("Ibuprofen 600 MG Oral Tablet",),
    "naproxen": ("Naproxen 500 MG Oral Tablet",),
    "acetaminophen": ("Acetaminophen 500 MG Oral Tablet",),
    "muscle relaxant": ("Cyclobenzaprine 10 MG Oral Tablet",),
}


def cc(system, code, display):
    return {"coding": [{"system": system, "code": code, "display": display}], "text": display}


def pick(mapping, text, default):
    t = text.lower()
    for k, v in mapping.items():
        if k in t:
            return v
    return default


def main(case_dir):
    spec = yaml.safe_load(open(os.path.join(case_dir, "case_spec.yaml")))
    cid = spec["case_id"].replace("_", "")  # FHIR ids allow only letters, digits, hyphen, dot
    baseline = json.load(open(spec["patient_baseline"]))
    patient = next(r for r in baseline if r["resourceType"] == "Patient")
    pref = {"reference": f"Patient/{patient['id']}"}
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
        priority=cc("http://terminology.hl7.org/CodeSystem/processpriority", "normal", "Normal"),
        insurance=[{"sequence": 1, "focal": True, "coverage": {"display": "Medicare Advantage plan (synthetic)"}}],
        item=[ClaimItem(sequence=1, productOrService=cc(SNOMED, str(proc["snomed"]), proc["text"]))],
    )
    add(claim)

    # Index condition
    code, disp = pick(INDEX_CODES, ep["index_condition"]["code_text"], ("M54.50", "Low back pain, unspecified"))
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
        add(Encounter(
            id=eid, status="finished",
            **{"class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB", "display": "ambulatory"}},
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
            scode, sdisp = pick(THERAPY_KIND, kind, ("91251008", "Physical therapy procedure"))
            add(Procedure(
                id=f"{cid}-pt-{pt_n:02d}", status="completed",
                code=cc(SNOMED, scode, sdisp), subject=pref,
                performedPeriod={"start": str(th["start"]), "end": str(th["end"])},
                note=[{"text": f"{th.get('sessions', '')} sessions".strip()}] if th.get("sessions") else None,
            ))
        else:
            med_n += 1
            (mdisp,) = pick(MED_KIND, kind, ("Ibuprofen 600 MG Oral Tablet",))
            add(MedicationRequest(
                id=f"{cid}-med-{med_n:02d}", status="active", intent="order",
                medicationCodeableConcept={"text": mdisp}, subject=pref,
                authoredOn=str(th["start"]),
                dosageInstruction=[{"text": f"{mdisp}, {th['start']} to {th['end']}",
                                    "timing": {"repeat": {"boundsPeriod": {"start": str(th["start"]), "end": str(th["end"])}}}}],
            ))

    # Prior imaging
    img_n = 0
    for im in ep.get("prior_imaging", []) or []:
        img_n += 1
        scode, sdisp = pick(IMAGING_KIND, im["kind"], ("241645004", "MRI of lumbar spine"))
        add(Procedure(
            id=f"{cid}-img-{img_n:02d}", status="completed", code=cc(SNOMED, scode, sdisp),
            subject=pref, performedDateTime=str(im["date"]),
        ))

    # Observations: listed observations and structured red flags
    obs_n = 0
    for o in (ep.get("observations", []) or []) + [
        {"text": rf if isinstance(rf, str) else rf.get("text"), "date": (rf.get("date") if isinstance(rf, dict) else None) or req_date, "red_flag": True}
        for rf in (ep.get("red_flags", []) or [])
    ]:
        obs_n += 1
        add(Observation(
            id=f"{cid}-obs-{obs_n:02d}", status="final",
            category=[cc("http://terminology.hl7.org/CodeSystem/observation-category", "exam", "Exam")],
            code={"coding": [{"system": LOINC, "code": "29545-1", "display": "Physical findings Narrative"}],
                  "text": ("Red flag: " if o.get("red_flag") else "") + o["text"]},
            subject=pref, effectiveDateTime=str(o.get("date") or req_date),
            valueString=o["text"],
        ))

    # Note as DocumentReference
    note_text = open(os.path.join(case_dir, spec["note"]["file"])).read()
    last_enc = str(ep["encounters"][-1]["date"]) if ep.get("encounters") else req_date
    add(DocumentReference(
        id=f"{cid}-note-01", status="current",
        type=cc(LOINC, "11506-3", "Progress note"), subject=pref, date=f"{last_enc}T12:00:00+00:00",
        description=f"Visit note ({spec['note'].get('style', 'standard')} style)",
        content=[{"attachment": {"contentType": "text/plain", "data": base64.b64encode(note_text.encode()).decode(),
                                 "title": "note.md"}}],
    ))

    entries = [BundleEntry(fullUrl=f"urn:uuid:{r['id']}" if r["resourceType"] == "Patient" else f"{r['resourceType']}/{r['id']}", resource=r)
               for r in baseline + resources]
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
