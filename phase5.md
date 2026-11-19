# Phase 5 — Legacy data migration

The legacy Google Sheet remains read-only. Before migration, create a Drive copy and export the source workbook to the ignored `backups/` directory.

## Prepare

Run `scripts/audit_legacy_workbook.py` to review aggregate values and anomalies. Then run `scripts/prepare_legacy_migration.py` to generate an idempotent SQL file and a non-patient audit summary.

Generated workbooks, audit outputs, and SQL containing patient data must remain under `backups/` and must never be committed.

## Normalization rules

- `General ORL` becomes `Gen ORL`.
- Excel replacement characters in degree-based procedure names are repaired to `°`.
- `Cinic` becomes `Clinic`; `wad` becomes `Ward`.
- A blank legacy source becomes `Clinic`.
- A blank legacy status becomes `DONE`.
- A blank legacy procedure is retained as inactive `Unspecified (Legacy)`.
- Historical procedure names not in the active catalog are inserted as inactive values.
- Each source row receives a stable `legacy_source_key`, so rerunning the same migration does not duplicate bookings.

## Verification

The generated SQL stops and rolls back if the staged or imported booking count differs from the workbook. Its final read-only audit reports imported bookings, date range, procedure links, and bookings without a procedure.
