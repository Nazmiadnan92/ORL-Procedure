# Phase 4 — Monthly statistics

The protected Admin Dashboard has a separate Monthly Statistics tab. Month names
use Malay January–December choices and the year dropdown is generated from the
available booking history, with the current year always included.

## Counting rules

- Malaysia time determines the month and year of every booking.
- One booking counts as one total case, regardless of how many procedures were
  selected.
- Clinic represents Outpatient and Ward represents Inpatient.
- Subspecialty counts are split into Clinic, Ward and Total in the agreed order.
- Every distinct procedure in a booking counts once in the procedure breakdown.
  Procedure rows sort by total volume descending and then alphabetically.
- Soft-deleted records never reach the Admin query, so they are excluded.
- Status is intentionally not included in Monthly Statistics.

Statistics are calculated from the full live booking history already protected by
Admin RLS. The page contains no separate public statistics endpoint.
