#!/usr/bin/env python3
"""Extract a thin, harmless baseline from a Synthea patient bundle.

Keeps: the Patient resource; up to three Condition resources from an allowlist of
stable chronic conditions; up to two MedicationRequest resources that treat them.
Drops everything else, and in particular anything that could touch a lumbar MRI
criterion (spine, back, radiculopathy, malignancy, infection, fracture, osteoporosis,
opioids, corticosteroids, any Procedure). Strips meta.profile and any reference to a
resource not kept, so the result validates against base FHIR R4 with no IG.

Usage:
  python3 eval/tools/extract_baseline.py <synthea bundle.json> [more bundles...]
  python3 eval/tools/extract_baseline.py --from-list data/golden/patients.txt
Output: data/golden/baselines/<patient-id>.json (a JSON array of resources).
"""
import json, os, re, sys, glob

OUT_DIR = "data/golden/baselines"
SYNTHEA_DIR = "data/synthea/output/fhir"

ALLOW_CONDITIONS = [
    r"\bhypertension\b", r"\bhyperlipidemia\b", r"\bdiabetes\b", r"\bhypothyroid",
    r"\bosteoarthritis of (the )?(knee|hip)\b", r"\bprediabetes\b",
]
BLOCK_CONDITIONS = [
    r"spin", r"back", r"lumb", r"radicul", r"sciatic", r"disc", r"malign", r"cancer",
    r"carcinoma", r"neoplasm", r"tumou?r", r"lymphoma", r"leukemia", r"infect", r"sepsis",
    r"fracture", r"osteopor", r"myelo", r"neuropath", r"paraly", r"weakness",
]
ALLOW_MEDS = [
    r"lisinopril", r"amlodipine", r"losartan", r"hydrochlorothiazide", r"metoprolol",
    r"atorvastatin", r"simvastatin", r"rosuvastatin", r"metformin", r"levothyroxine",
    r"glipizide", r"insulin",
]
BLOCK_MEDS = [
    r"oxycodone", r"hydrocodone", r"morphine", r"fentanyl", r"tramadol", r"codeine",
    r"prednison", r"dexamethasone", r"methylprednisolone", r"hydrocortisone",
    r"gabapentin", r"pregabalin", r"cyclobenzaprine",
]


def text_of(resource):
    code = resource.get("code") or resource.get("medicationCodeableConcept") or {}
    parts = [code.get("text", "")] + [c.get("display", "") for c in code.get("coding", [])]
    return " ".join(p for p in parts if p).lower()


def matches(text, patterns):
    return any(re.search(p, text) for p in patterns)


def strip(resource, kept_refs):
    resource = json.loads(json.dumps(resource))
    if "meta" in resource:
        resource["meta"].pop("profile", None)
        if not resource["meta"]:
            resource.pop("meta")

    def walk(obj):
        if isinstance(obj, dict):
            for k in list(obj.keys()):
                v = obj[k]
                if isinstance(v, dict) and "reference" in v and isinstance(v["reference"], str):
                    if v["reference"] not in kept_refs:
                        del obj[k]
                        continue
                walk(v)
        elif isinstance(obj, list):
            for i in range(len(obj) - 1, -1, -1):
                item = obj[i]
                if isinstance(item, dict) and "reference" in item and item["reference"] not in kept_refs:
                    del obj[i]
                else:
                    walk(item)
    walk(resource)
    return resource


def extract(path):
    with open(path) as f:
        bundle = json.load(f)
    resources = [e["resource"] for e in bundle.get("entry", [])]
    patient = next(r for r in resources if r["resourceType"] == "Patient")
    pid = patient["id"]
    conditions = [r for r in resources if r["resourceType"] == "Condition"
                  and matches(text_of(r), ALLOW_CONDITIONS)
                  and not matches(text_of(r), BLOCK_CONDITIONS)
                  and (r.get("clinicalStatus", {}).get("coding", [{}])[0].get("code") == "active")]
    # one per distinct display text
    seen, uniq = set(), []
    for c in conditions:
        t = text_of(c)
        if t not in seen:
            seen.add(t); uniq.append(c)
    conditions = uniq[:3]
    meds = [r for r in resources if r["resourceType"] == "MedicationRequest"
            and matches(text_of(r), ALLOW_MEDS)
            and not matches(text_of(r), BLOCK_MEDS)
            and r.get("status") == "active"]
    seen, uniq = set(), []
    for m in meds:
        t = text_of(m)
        if t not in seen:
            seen.add(t); uniq.append(m)
    meds = uniq[:2]
    kept = [patient] + conditions + meds
    kept_refs = {f"{r['resourceType']}/{r['id']}" for r in kept} | {f"urn:uuid:{r['id']}" for r in kept}
    out = [strip(r, kept_refs) for r in kept]
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{pid}.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"{pid}: Patient + {len(conditions)} Condition + {len(meds)} MedicationRequest -> {out_path}")


def main():
    if "--from-list" in sys.argv:
        ids = [l.strip() for l in open(sys.argv[sys.argv.index("--from-list") + 1]) if l.strip()]
        paths = []
        for pid in ids:
            hits = glob.glob(os.path.join(SYNTHEA_DIR, f"*{pid}.json"))
            if not hits:
                print(f"no bundle found for {pid}", file=sys.stderr); continue
            paths.append(hits[0])
    else:
        paths = sys.argv[1:]
    if not paths:
        print(__doc__); sys.exit(1)
    for p in paths:
        extract(p)


if __name__ == "__main__":
    main()
