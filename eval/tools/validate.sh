#!/bin/bash
# Validate one case bundle against base FHIR R4. Run from the repository root:
#   bash eval/tools/validate.sh data/golden/case_01
# -tx n/a: checks structure only, without an online terminology server, so the result is the same on every machine and every day.
#   The SNOMED, LOINC and ICD-10-CM codes the renderer writes were checked by hand (see render_case.py).
# -extension: allows Synthea's own extensions (for example disability-adjusted life years).
# -ig eval/fhir-defs: loads only the US Core race, ethnicity, and birth sex extension definitions.
# Any extra words after the folder name are passed on to the validator.
# The validator's own summary line sits in the middle of its output, so it is repeated as the last line.
log=$(mktemp)
java -jar tools/validator_cli.jar "$1/bundle.json" -version 4.0.1 -tx n/a -extension http://synthetichealth.github.io/ -ig "$(pwd)/eval/fhir-defs" "${@:2}" 2>&1 | tee "$log"
echo
echo "Summary for $1:"
grep -E '^(Success|\*FAILURE\*)' "$log" || echo "No summary line found. The validator did not finish; read the messages above."
rm -f "$log"
