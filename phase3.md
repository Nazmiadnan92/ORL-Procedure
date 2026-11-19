# Phase 3 — Admin management

Admin access uses Supabase Auth and the pre-approved `orlprosedur@gmail.com`
identity. The browser stores only the standard Supabase session. No password,
secret key or service-role key is present in the repository.

## Admin flow

- The Admin page verifies `is_admin()` after every restored or new session.
- Admin can read all live historical bookings and filter them by text, Patient
  Source and Status.
- Doctor, Patient Name, Subspecialty, Affected Region and Patient Source are
  rendered as locked values.
- Procedure is edited from its table cell with searchable multi-selection.
  Active choices follow historical usage order. Notes saves on blur and Status
  saves immediately from its dropdown.
- Every update sends the row revision to `update_booking`. A stale revision is
  rejected and the history is refreshed instead of silently overwriting data.
- Delete calls `delete_booking` only after an in-app confirmation. It is a soft
  delete, so the record disappears from lists and statistics but remains
  recoverable in the database.

Staff Booking List still applies explicit Malaysia-day bounds in the browser.
This keeps it limited to today even when an Admin session is active in the same
browser. Realtime changes, visibility refresh and a 30-second fallback keep both
Staff and Admin lists current.
