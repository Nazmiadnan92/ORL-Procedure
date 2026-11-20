# Phase 6 — Production release

The production website is published from the repository's `main` branch and root directory through GitHub Pages.

## Release checks

- Run the complete automated test suite before every production push.
- Confirm the Staff form, today's Booking List, procedure popularity order, and Admin login on the public URL.
- Confirm the Admin history and Monthly Statistics can read the migrated Supabase records.
- Keep the former AppSheet short link unchanged until the public URL passes these checks.

## Cutover

Production was verified at `https://nazmiadnan92.github.io/ORL-Procedure/`. The existing Staff link, `https://bookprocedure.s.gy/`, now redirects to that production URL. The short link remains the stable Staff-facing address even if hosting changes later.
