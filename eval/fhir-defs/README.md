# FHIR definitions loaded by the validator

Three extension definitions from HL7's US Core implementation guide: race, ethnicity, and birth sex. Synthea writes these extensions on every Patient, and the race extension is what the paired fairness check (case 09) changes.

They are here so the validator recognizes those three extensions without loading all of US Core. Nothing else from US Core is used, and no bundle claims to conform to a US Core profile; validation is against base FHIR R4 (see `eval/tools/validate.sh` and DATASHEET.md).

Source: https://github.com/HL7/US-Core, `input/resources/`, fetched 2026-10-13. License: CC0-1.0 (as declared in that repository's `sushi-config.yaml`).
