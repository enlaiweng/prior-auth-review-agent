#!/usr/bin/env python3
"""List living Synthea patients: id, age at the reference date, sex, race.

Usage: python3 eval/tools/list_patients.py [output_fhir_dir] [--min-age N] [--pick N]
  --pick 20  prints only ids: 15 aged 65 or older and 5 aged 55 to 64, alternating sex,
             which is the golden set's intended Medicare Advantage mix. Redirect into
             data/golden/patients.txt.
Default directory: data/synthea/output/fhir. Reference date for age: 2026-08-15
(the default request date used in case specs).
"""
import json, sys, glob, os
from datetime import date

REF = date(2026, 8, 15)
RACE_URL = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race"


def race_of(patient):
    for ext in patient.get("extension", []):
        if ext.get("url") == RACE_URL:
            for sub in ext.get("extension", []):
                if sub.get("url") == "text":
                    return sub.get("valueString", "")
    return ""


def main():
    argv = sys.argv[1:]
    min_age = 0
    if "--min-age" in argv:
        i = argv.index("--min-age")
        min_age = int(argv[i + 1])
        del argv[i:i + 2]
    pick = 0
    if "--pick" in argv:
        i = argv.index("--pick")
        pick = int(argv[i + 1])
        del argv[i:i + 2]
    folder = argv[0] if argv else "data/synthea/output/fhir"
    rows = []
    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        base = os.path.basename(path)
        if base.startswith(("hospitalInformation", "practitionerInformation")):
            continue
        with open(path) as f:
            bundle = json.load(f)
        patient = next((e["resource"] for e in bundle.get("entry", [])
                        if e["resource"]["resourceType"] == "Patient"), None)
        if not patient or "deceasedDateTime" in patient:
            continue  # skip deceased patients; a prior auth request needs a living member
        b = date.fromisoformat(patient["birthDate"])
        age = REF.year - b.year - ((REF.month, REF.day) < (b.month, b.day))
        if age < min_age:
            continue
        rows.append((patient["id"], age, patient.get("gender", ""), race_of(patient), base))
    if pick:
        older = [r for r in rows if r[1] >= 65]
        younger = [r for r in rows if 55 <= r[1] < 65]
        chosen = []
        for pool, n in ((older, min(15, pick * 3 // 4)), (younger, pick)):
            males = [r for r in pool if r[2] == "male"]; females = [r for r in pool if r[2] == "female"]
            while len(chosen) < (n if pool is older else pick) and (males or females):
                if females: chosen.append(females.pop(0))
                if len(chosen) < (n if pool is older else pick) and males: chosen.append(males.pop(0))
        for r in chosen[:pick]:
            print(r[0])
        print(f"picked {len(chosen[:pick])} ({sum(1 for r in chosen[:pick] if r[1] >= 65)} aged 65+)", file=sys.stderr)
        return
    print(f"{'id':38} {'age':>3} {'sex':6} {'race':8} file")
    for pid, age, sex, race, base in rows:
        print(f"{pid:38} {age:>3} {sex:6} {race:8} {base}")
    print(f"\n{len(rows)} living patients", file=sys.stderr)


if __name__ == "__main__":
    main()
