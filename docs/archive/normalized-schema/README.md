# Archived: normalized database design (12–13 Oct)

An earlier design kept every record in its own Postgres table with row-level security and
SECURITY DEFINER functions, plus separate Edge Functions per task. It is kept here for reference
only. **Nothing in this folder is used by the live site.**

The live site (14 Oct) uses `supabase/setup.sql` and one Edge Function, `btw-api`, which runs the
same permission engine as the app (`web/src/core.js`) on the server. That is simpler to set up from
the Supabase dashboard and keeps one set of rules for the browser copy and the server.

If the team grows to the point where one shared document is too slow (thousands of staff), this
design is the starting point for moving to separate tables. The tests here still run:
`node --test docs/archive/normalized-schema/rls.test.js` (paths inside the test may need adjusting).
