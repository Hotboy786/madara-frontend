# Optional TikTok account workspace

This change adds a **TikTok Accounts** tab to the existing Madara frontend.
Selecting it enters a focused screen: the existing header and navigation hide,
and the TikTok workspace fills the window. A small **Back to main panel** button
returns to the original Order tab and restores the existing layout.

Existing `script.js`, `style.css`, and the Node proxy backend are unchanged.
The added CSS is namespaced and only changes the shell while the TikTok tab is
active. The new script uses its own localStorage key and does not access existing
provider credentials, schedules, or order state.

## Activate

1. Set up Supabase using `tiktok-service/supabase.sql` and its README.
2. Create a **separate** Render Docker Web Service from this repository. Set its
   Root Directory to `tiktok-service`; keep the existing backend service as-is.
3. Configure the environment values listed in `tiktok-service/.env.example`.
   Set `ALLOWED_EMBED_ORIGINS` to your existing frontend's exact HTTPS origin,
   for example `https://your-panel.vercel.app`. No wildcard. This lets only your
   chosen frontend frame the new workspace; its own member login still applies.
4. In a frontend preview, open **TikTok Accounts**, enter the new Render service's
   HTTPS origin, then click **Open workspace**. The URL is remembered in this
   browser only; your brother should configure it once in his browser too.
5. Sign into the workspace, add an account, sign into TikTok, then select
   **Save profile & release**. Test restore after restarting the new service.
6. Check the original API, Order, Tracker, Schedules, and Logs tabs in the preview
   before merging. No live provider orders are needed for this check.

The workspace iframe is lazy: no remote browser or Supabase traffic occurs until
you explicitly open the service. Switching away pauses screenshot polling; the
browser service attempts a backup after two minutes idle. Save/release explicitly
before leaving to avoid losing recent login changes on an unexpected restart.

## Verification and limits

Seven service unit checks pass with cloud/browser interactions mocked. Syntax
and source-preservation checks cover the add-on. Live Render, Supabase, TikTok,
iframe rendering, and real provider regression tests have not been run. The
free-tier browser may run out of memory or encounter TikTok challenges.

Gmail code recovery and uploading local video files are not implemented.
This change is prepared for review; the current working panel is not deployed
or replaced as part of the change.
