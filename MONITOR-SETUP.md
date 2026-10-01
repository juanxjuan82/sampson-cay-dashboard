# Media & Public Claims Monitor

A deterministic monitor linked from the three dashboard pages, with feed routes in the repository Worker code. No live deployment of that Worker has been verified. The existing dashboard AI summary integration is restored. Its previously deployed endpoint is https://sampson-cay-dashboard-ai.john-aymes.workers.dev; saved endpoint overrides and session tokens continue to work. Private AI drafts use the existing server-side OPENAI_API_KEY and OPENAI_MODEL configuration, on explicit editor request. Refreshing sources uses no AI tokens.

## Included

- Public HTML monitoring of Turtlegrass's campaign/blog, The Tribune Business, Eye Witness News, and the official project website.
- Checks every six hours plus a Refresh button; a renewable, owner-scoped collection lock and five-minute cooldown prevent repeated concurrent collection.
- Bounded same-host discovery: up to three new relevant links plus three previously collected pages per source per check. Previously collected pages rotate by oldest collection attempt, so they remain monitored after leaving a landing page. Failed pages record an item-level collection error and do not block the rotation. New candidate attempts and rejections are retained and rotated by oldest attempt, so stable false positives cannot hide valid links behind them. This is **not an exhaustive news archive**. Only pages mentioning Yntegra, Sampson Cay, Rosewood Exuma or Turtlegrass are retained.
- Explicit theme/phrase rules, canonical URL deduplication, first-seen and changed timestamps, review status, recent theme counts, source health, preserved HTML versions and SHA-256 hashes.
- Private AI or manual recommendations require editing, save + explicit publish. Client API selects only published text; new drafts cannot replace it automatically. Source changes block publication until reviewed and saved again. Published recommendations show a source-change warning if subsequently outdated. Editor can withdraw a published recommendation.
- Editor-only snapshot export; exports are JSON to prevent archived HTML executing in the dashboard. Capture exports and editorial actions are logged. The archive is a source record, not a claim of legal admissibility.

## Deploy

1. In `worker`, install dependencies: `npm install`.
2. Use the existing Cloudflare deployment credentials: `npx wrangler login`.
3. The database ID supplied by the owner is already configured: `e3994f38-b2a1-4b9a-b1a0-505332d0e06d`.
4. Confirm this database belongs to the deployment account; preserve existing AI secrets when deploying.
5. Apply migration: `npx wrangler d1 migrations apply sampson-cay-monitor --remote`.
6. Set different, randomly generated MONITOR_EDITOR_TOKEN and MONITOR_CLIENT_TOKEN secrets. Share only MONITOR_CLIENT_TOKEN with the client. The monitor's editor access is independent of AI credentials; never embed either token in HTML or repository files.
7. Add the actual dashboard origin to ALLOWED_ORIGINS if it differs from GitHub Pages. CORS complements token authorization; it is not the permission boundary.
8. Preserve existing OPENAI_API_KEY, OPENAI_MODEL and DASHBOARD_AI_TOKEN configuration. The summary route is unchanged; monitor AI drafts use the same key/model. No separate AI service is required.
9. Deploy: `npm run deploy`. Publish the root static files through the dashboard's existing hosting process.
10. Open `monitor.html`, connect to the existing Worker URL with editor credentials, and refresh. Connect separately with client credentials to verify that drafts remain invisible. Test each source's actual collection status; robots restrictions, changing layouts, limits and network errors are surfaced rather than bypassed.

## Editorial flow

Open an item → review the source → set its status to Reviewed → Generate AI draft (or write manually) → edit a recommendation → Save private draft → Publish to client. Source review is tied to the displayed content hash; a stale review cannot mark newer content reviewed. Publishing displays a confirmation. Version checks reject stale saves and publish requests; updating a private draft leaves the previously published version visible. Publication is to the monitoring dashboard, not to social media.

## Coverage limits

Social collection is not connected: no Facebook/Instagram stories, reels, comments, private groups or engagement metrics. Our News has not been added without a verified crawlable source. Additional accounts need verified API/provider access before coverage can be promised. Theme counts are monitored-item counts, not population sentiment, reach or evidence of coordination. Sources are labelled as publishers, not as validated truth. Listings are also retained when relevant, so changes may reflect listing updates; always inspect the original source.

Article publication and recommendation publication have separate timestamps. Changed source content resets its review status to unreviewed; unchanged content preserves the status. Run all database migrations, including 0002_item_collection_status.sql and 0005_redirect_history.sql.

Collector removes script/navigation/footer/form elements before text comparison. Changes to retained page text can still include unrelated page furniture, so the UI labels them page updates rather than new allegations. Publication dates are extracted only from available page metadata, otherwise shown as unavailable. Raw captures are bounded to 1 MB; database retention/storage budgets should be reviewed before expanding the watchlist. Counsel should define any formal preservation requirements.

## Verification

`npm run check` and `npm test` in `worker`; `node --check monitor.js` at root. Tests use real SQLite for the D1-compatible SQL and cover client/editor isolation, unpublished draft exclusion, human edit gating, stale version/source rejection, withdrawal, robots and redirect/size restrictions. No live AI request is required. The D1 configuration uses the database ID supplied by the owner.


The feed API returns 100 items per page with a changed-at/id cursor. The dashboard retrieves every page before rendering counts and filters; older items remain available to clients and editors, including their published advice and withdrawal controls.

Redirected stored pages are retired from the feed, preserving their original URL, captures and advice. The destination editor links to this history. Advice is never automatically transferred or published on the new destination.
