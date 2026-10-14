# Going live

About an hour, once. You need: a Supabase account (free plan is enough to start), a GitHub
account, and this repository. Nothing here costs money unless you choose a paid plan.

An Arabic step-by-step version of this guide is kept with the project documents.

## 1. Supabase: database, storage and the server

1. Sign in at supabase.com → **New project**. Name it `btw-training`, pick the region nearest to
   you, and save the database password in your password manager.
2. **SQL Editor → New query**: paste all of [`supabase/setup.sql`](../supabase/setup.sql) → **Run**.
   It creates the locked-down tables and the private `cards` bucket. Running it again is safe.
3. **Edge Functions → Deploy a new function → Via Editor**. Name: `btw-api` (exactly). Replace the
   sample code with all of [`supabase/functions/btw-api/index.ts`](../supabase/functions/btw-api/index.ts)
   → **Deploy function**.
4. Open the `btw-api` function's settings and **turn off JWT verification** ("Verify JWT"). The
   function checks its own sign-in sessions. If this stays on, the site shows "server setup problem
   (HTTP 401)".
5. **Edge Function Secrets** → add `SETUP_CODE` with a long phrase only you know (for example four
   random words and a number). Save it in your password manager: it creates the first
   Administrator and resets the Administrator password if it is ever lost.
6. **Settings → API Keys**: copy the **Project URL** and the **publishable key**
   (`sb_publishable_…`; older projects call it the `anon` `public` key). Never copy the secret /
   service_role key anywhere.

## 2. GitHub: the website

1. Create a repository, for example `training`. **Public** is fine and free: the repository holds
   only code — no staff data, no passwords, no keys that matter. To keep the code private you need a
   paid GitHub plan; the website itself is reachable by anyone with the link either way (everything
   behind it needs a sign-in).
2. Upload this project's files (unzipped) to the repository: GitHub Desktop, `git push`, or
   **Add file → Upload files**. Check that the `.github/workflows` folder arrived.
3. Open `config.js` in the repository → edit (pencil) → paste the Project URL and publishable key
   from step 1.6 → **Commit changes**.
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Actions** tab: wait for **Publish site** to turn green (a few minutes; it runs the tests first).
   Your site is at `https://<your-user>.github.io/training/`.
6. Back in Supabase → Edge Function Secrets, add `ALLOWED_ORIGIN` = `https://<your-user>.github.io`
   so no other website can use your server. Optionally set `siteUrl` in `config.js` to the full site
   address; certificate QR codes then point to it.

## 3. First run

1. Open the site. It shows **Create the administrator account**. Enter the setup code, your name,
   your work email and a password. This is the only Administrator; it can change everything.
2. Use a password with letters and numbers. To change it later: your name (top corner) → Profile.
3. **Locations and teams**: add your branches (a "Head office" location is created for you).
4. **People**: add managers and staff one by one, or **Import** a CSV (download the template on the
   import page). Each person signs in with their employee code or work email and the password you
   set; with "ask for a new password" ticked they choose their own at first sign-in.
5. **Courses → New course** (for example "Product knowledge") → **Add section** per product group →
   in each section **Upload PDF cards**. Name files `01 - Espresso.pdf`, `02 - Latte.pdf`, …: the
   number sets the order, the rest becomes the title (editable before uploading). PDF only, up to
   50 MB each.
6. In each section add the **section quiz**; add a **final assessment** on the course page;
   **Publish**; then **Assign training** to a branch, team, role or people.
7. **Settings → Training**: seconds each card must stay on screen before "Next" (default 5).
8. Send staff the link. On phones: browser menu → **Add to Home Screen**.

## 4. Running it

- **Content and people** change inside the site; nothing to redeploy.
- **Code changes** pushed to `main` republish the website automatically. If a change touches
  `web/src/core.js` or `server/`, run `npm run build` and update the function (paste the new
  `index.ts` with **Deploy updates**, or run the **Update server function** workflow).
- **Backups:** the database keeps the last 10 saves plus one per day for 14 days
  (`app_state_history`; undo steps are at the end of `setup.sql`). Download **Backups and data →
  Full export** monthly and keep it somewhere private. The paid Supabase Pro plan adds daily
  database backups.
- **Free plan limits** (check supabase.com/pricing): 500 MB database, 1 GB file storage,
  500,000 function calls a month; a free project is paused after 7 days with no activity. Move to
  Pro if you outgrow them — that is a paid service, so it is your decision.
- **Your own address** (for example `training.btw.sa`) needs a DNS record at your domain provider
  plus **Settings → Pages → Custom domain**. Only do this when you decide to; then update
  `ALLOWED_ORIGIN` and `siteUrl`.
- **Lost Administrator password:** sign-in page → "Administrator: forgot password?" → setup code.
