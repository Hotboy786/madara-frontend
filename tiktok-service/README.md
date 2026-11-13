# TikTok Account Studio — online prototype

This replaces the local Windows launcher with a deployable, shared browser panel.
It has an **Add TikTok account** button and account list on the left, and a remote
Chromium browser in the main area. Both workspace members can use the same saved
profiles. One person controls one active account at a time.

**Status:** source prepared, not deployed. Supabase, Render, TikTok login, and
browser performance on Render's free instance must be tested on your own services.
Seven unit tests passed for encrypted archive restoration, invalid archive
rejection, access checks, control leases, backup ordering/failures, and the account
limit. Python and browser JavaScript syntax checks passed. Cloud and Chromium
interactions were mocked; no real TikTok or deployed browser test has run.
No service credentials are included. This is a prototype, not a promise of reliable
24/7 service on a free plan.

## How it works

1. Sign in to your panel using a Supabase Auth email/password account.
2. Click **Add TikTok account**, name the space, and log in on the real TikTok
   website displayed in the remote browser. QR codes can be scanned from the screen.
3. Click **Save profile & release** after login. The backend closes Chromium to
   flush its profile, encrypts a compressed profile archive, uploads it to a private
   Supabase Storage bucket, and records its location in Postgres.
4. Select the account again to reopen it. A new server restores its last saved
   archive before launching Chromium. Moving to another account also saves the
   previous profile. After 2 minutes with no frame or action requests, the backend
   attempts a save and closes the idle browser.
5. Your brother signs in to the same panel with his own approved email address and
   opens the same accounts. The browser has a 90-second control lease, renewed by
   frames/actions. Other tabs and members are blocked while it is in use. Saving
   and releasing hands control over immediately.

This shows browser screenshots approximately every 1.6 seconds and sends clicks,
typing, keys, and scrolling to the server. It is an interactive remote browser,
not a TikTok API integration or an iframe. Login detection, audio/video streaming,
file upload/download, drag-and-drop, live analytics, automatic posting, and Gmail
code recovery are not implemented. The upload controls of the TikTok website do
not currently have a local-to-remote file picker bridge.

Profiles include sensitive authentication data. Encryption uses a server-side
Fernet key; the Supabase service-role key and encryption key never reach clients.
All allowed panel members can access all saved TikTok profiles. Use this only for
accounts you own or have permission to manage. No public signup UI is provided.

## Set up Supabase

1. Create your own Supabase project.
2. Run `supabase.sql` in its SQL Editor. It creates the account table with RLS and
   no client-access policies, and a private `tiktok-profiles` Storage bucket.
   The server uses service-role access; do not make the bucket public.
3. In Authentication → Users, create/invite and confirm a panel user for yourself
   and your brother. Give each person their own panel password. These are not
   TikTok credentials. Disable public signup if you do not need it.
4. Obtain the project URL, anon/publishable key, and server service-role key from
   project settings. Enter them directly into your host's environment settings.
   Do not paste secret keys into a chat or commit an `.env` file.
5. Generate one profile encryption key and keep a private copy:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Run that command after installing `requirements.txt`, or in a trusted local
   Python environment with `cryptography` installed. Keep the same key on every
   deployment: changing or losing it makes old backups unreadable.

## Deploy on Render

1. Put this directory's source into a private GitHub repository. Keep the
   `Dockerfile`, `render.yaml`, and `requirements.txt` at the repository root.
2. In Render, create a Blueprint from that repository, or create a Docker Web
   Service. `render.yaml` requests the free plan; no paid resources are declared.
3. Set these secret environment variables when Render requests them:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Your HTTPS Supabase project URL |
   | `SUPABASE_ANON_KEY` | Anon/publishable API key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role API key |
   | `PROFILE_ENCRYPTION_KEY` | Fernet key generated above |
   | `ALLOWED_EMAILS` | Your email and your brother's email, separated by a comma |

4. Deploy and open the HTTPS Render URL. `/health` is available for health checks.
   It reports whether environment values are present; it does not validate the
   Supabase schema, credentials, browser launch, or successful TikTok login.
5. Test adding one account, signing in, saving, switching, and reopening before
   adding all 20. Then restart/redeploy the service and verify the saved profile
   restores successfully. Finally test your brother's independent panel login.

Run **exactly one backend worker and one replica**. The control lease and browser
are process-local. Multiple replicas require distributed locking and routing;
they are not supported by this prototype.

Vercel can host a separate frontend, but this Docker backend needs a host that
can run Chromium. Keeping the UI and backend on Render avoids an extra domain,
cross-origin authentication, and deployment.

## Free-plan limits and saved sessions

An uptime monitor is optional and not required for profile persistence. Render
can restart services at any time; a ping does not prevent that. Uncommitted
browser changes since the last successful **Save profile & release** may be lost
on a crash, forced termination, or redeploy. Graceful shutdown attempts a save,
but it cannot guarantee enough shutdown time for a large archive.

Supabase stores account records and encrypted profile archives. It does not
extend TikTok session validity. TikTok can invalidate a session or require a
CAPTCHA, device verification, password, phone code, or email code. A datacenter
browser can also be challenged or rejected. This app does not bypass those checks.

The browser uses memory, and screenshots/profile backups consume bandwidth and
storage. A single browser may still exceed a free host's resources. The prototype
backs up bounded profiles (200 MiB uncompressed, 35 MiB compressed); oversized
profiles show a backup error. The previous successful backup remains intact if
a new upload fails. Supabase object storage is used for archives, not database
rows containing raw cookies.

If an upload succeeds but the database update fails, an orphaned encrypted object
may remain in the private bucket. Review and remove obsolete objects periodically;
never delete the object referenced by an account's `profile_key`.

## Gmail recovery (future feature)

Not included. A possible extension uses an explicitly authorized Google OAuth
connection for each inbox to retrieve a freshly requested TikTok email code. It
must associate the correct inbox, recipient, request time, and account, and must
not log or retain OTPs. Gmail read scopes are restricted and may require Google
verification or an applicable exception. This still cannot handle every TikTok
challenge. Do not store Gmail passwords in the account notes.

## Embed in an existing panel

Set `ALLOWED_EMBED_ORIGINS` to the existing panel's exact HTTPS origin. By default
the service refuses framing. When configured, CSP permits only those exact
origins; no wildcard is used. Sign-in tokens stay in the iframe's memory, so
third-party cookies are not required. The iframe remains a separate origin.

The Madara add-on sends a visibility message when its tab hides or reappears.
The service pauses frame polling in a hidden tab and reopens the selected account
when the tab returns. Idle profile backups are still best-effort: explicitly save
and release before leaving if new login data must be backed up immediately.

## Local development

The deployment image includes Chromium. To run locally instead:

```bash
python -m pip install -r requirements.txt
python -m playwright install chromium
# Set environment variables from .env.example using your shell or host.
# This application does not automatically load .env files.
python -m uvicorn app:app --host 127.0.0.1 --port 10000 --workers 1
```

Do not use reload mode when testing saved profiles. Open http://127.0.0.1:10000.
Use HTTPS when deployed. Browser downloads, automatic email recovery and uploading
local video files are outside this prototype's current functionality.

References: [Render free services](https://render.com/docs/free),
[Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Playwright persistent contexts](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context),
[Gmail authorization scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
