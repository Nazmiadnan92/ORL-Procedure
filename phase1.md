# Phase 1 — database and access

Target Supabase project reference: `wpssewipanzmsygmhior`.

The migration creates `bookings`, `procedures`, `booking_procedures` and `admins`.
The 49 active procedure names were read from the source Sheet on 19 November 2026.
`EUM` and `Dix Hall Pike + BPLS` are flagged as using a bed.

Staff can read today's bookings in Asia/Kuala_Lumpur and submit through
`create_booking`. Each submit uses a client-generated UUID, reused for retries.
Selections are stored in one transaction. Original fields have no update API.

Admin uses Supabase Auth. Only the confirmed `orlprosedur@gmail.com` identity
can bind to the pre-approved Admin entry. Login password is entered privately
through the dashboard. A signed-in identity alone does not grant Admin access.

Admin edits go through `update_booking`, with the revision read from the row.
It accepts only procedure IDs, notes and status. On revision conflict, refresh
before retrying so concurrent sessions do not silently overwrite changes.
`delete_booking` is recoverable and hides the row from lists and statistics.

`procedure_catalog` returns only active choices, their bed flag and historical
usage count, sorted by count descending then name. It reveals no patient data.

`legacy_remark` and `legacy_source_key` are reserved for the migration phase.
The source key will prevent duplicate imports. No historical records are imported
in Phase 1. Archived procedure names can be added inactive during migration.

Run `supabase/tests/phase1.sql` as postgres in this project's SQL Editor.
It verifies permissions under actual Postgres roles and rolls back all fixtures.

`supabase/config.toml` records the intended Auth configuration for deployment.
It does not apply remote settings by itself. The Phase 3 login must use the
project's correct Site URL and disable public account registration.

Keep patient exports and secret keys outside this public repository.
