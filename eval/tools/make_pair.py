#!/usr/bin/env python3
"""Make a paired fairness duplicate of a golden case, with one attribute of the patient changed.

Usage (from the repository root):
  python3 eval/tools/make_pair.py sex  data/golden/case_01 --given "Dale50 Oliver319"
  python3 eval/tools/make_pair.py race data/golden/case_09
Writes:
  data/golden/baselines/<patient-id>-pair-<attribute>.json   the baseline with the one attribute changed
  data/golden/<case>_pair_<attribute>/case_spec.yaml          the original spec, pointing at that baseline
  data/golden/<case>_pair_<attribute>/note.md                 an exact copy of the original note
Then render it as usual: python3 eval/tools/render_case.py data/golden/<case>_pair_<attribute>

What changes (EVAL_PLAN.md, paired fairness checks):
  sex:  Patient.gender, the US Core birth sex extension, the sex-specific name prefix (Mr., Mrs., Ms.), the
        given names (replaced by --given, so the names do not point back to the original sex), and any maiden
        name entry, which Synthea writes for married women only
  race: the US Core race extension (category code and text), White to Black or African American, or the reverse
Nothing else changes: the case id, every resource id, every date, and the note stay the same, so the pair
shares its original's labels and any difference in the agent's output comes from that one attribute.
The notes of the two source cases are written without pronouns or race, so they need no edit.
"""
import json, os, sys

RACE_URL = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race"
BIRTHSEX_URL = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex"
OMB = "urn:oid:2.16.840.1.113883.6.238"
RACES = {"White": ("2106-3", "White"), "Black or African American": ("2054-5", "Black or African American")}


def change_sex(patient, given):
    if not given:
        raise SystemExit('the sex pair needs --given "<given names>" matching the new sex')
    to = "female" if patient["gender"] == "male" else "male"
    patient["gender"] = to
    for ext in patient.get("extension", []):
        if ext.get("url") == BIRTHSEX_URL:
            ext["valueCode"] = "F" if to == "female" else "M"
    patient["name"] = [n for n in patient.get("name", []) if n.get("use") != "maiden"]
    for name in patient["name"]:
        if name.get("prefix"):
            name["prefix"] = ["Ms." if to == "female" else "Mr."]
        name["given"] = given.split()
    return f"sex changed to {to}, given names {given}, maiden name entry removed"


def change_race(patient, given=None):
    for ext in patient.get("extension", []):
        if ext.get("url") != RACE_URL:
            continue
        current = next(s["valueString"] for s in ext["extension"] if s["url"] == "text")
        target = "Black or African American" if current == "White" else "White"
        code, text = RACES[target]
        for sub in ext["extension"]:
            if sub["url"] == "ombCategory":
                sub["valueCoding"] = {"system": OMB, "code": code, "display": text}
            if sub["url"] == "text":
                sub["valueString"] = text
        return f"race changed from {current} to {target}"
    raise SystemExit("no US Core race extension on this patient")


def main(attr, case_dir, given=None):
    case_dir = case_dir.rstrip("/")
    if "_pair_" in os.path.basename(case_dir):
        raise SystemExit("this folder is already a pair; run the tool on the original case")
    spec_text = open(os.path.join(case_dir, "case_spec.yaml")).read()
    base_line = next(l for l in spec_text.splitlines() if l.startswith("patient_baseline:"))
    base_path = base_line.split(":", 1)[1].strip()
    resources = json.load(open(base_path))
    patient = next(r for r in resources if r["resourceType"] == "Patient")
    what = {"sex": change_sex, "race": change_race}[attr](patient, given)
    pair_base = base_path.replace(".json", f"-pair-{attr}.json")
    json.dump(resources, open(pair_base, "w"), indent=1)
    out = f"{case_dir}_pair_{attr}"
    os.makedirs(out, exist_ok=True)
    header = (f"# Paired fairness duplicate of {os.path.basename(case_dir)} (EVAL_PLAN.md): identical except the patient's {attr}.\n"
              f"# Made by eval/tools/make_pair.py; {what}. Same case id and resource ids, so it shares the original's labels.\n")
    open(os.path.join(out, "case_spec.yaml"), "w").write(header + spec_text.replace(base_line, f"patient_baseline: {pair_base}"))
    open(os.path.join(out, "note.md"), "w").write(open(os.path.join(case_dir, "note.md")).read())
    print(f"{out}: {what}; baseline {pair_base}")


if __name__ == "__main__":
    args = sys.argv[1:]
    given = None
    if "--given" in args:
        i = args.index("--given"); given = args[i + 1]; del args[i:i + 2]
    if len(args) != 2 or args[0] not in ("sex", "race"):
        print(__doc__); sys.exit(1)
    main(args[0], args[1], given)
