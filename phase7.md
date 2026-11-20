# Phase 7 — Admin performance

The Admin view now loads at most 100 bookings per page instead of downloading the full history.

- Search, source and status filters run in Supabase.
- Monthly statistics query only the selected month and year.
- The 30-second polling loop was removed.
- Realtime database events, tab focus and the manual refresh button trigger updates.
- The desktop table uses seven wrapped columns without horizontal scrolling.
- Patient/Doctor and Subspecialty/Source are stacked so no information is removed.

Database functions are defined in `supabase/migrations/202611210001_admin_performance.sql`.
