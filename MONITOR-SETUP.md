# Media & Public Claims Monitor

A deterministic monitor linked from the existing three dashboard pages, served by the existing dashboard AI Worker. Its `/summary` feature is preserved; private recommendation drafts reuse its OPENAI_API_KEY, OPENAI_MODEL and service URL. No second AI service is created.

## Included

- Public HTML monitoring of Turtlegrass's campaign/blog, The Tribune Business, Eye Witness News, and the official project website.
- Checks every six hours plus a Refresh button; a global collection lock and five-minute cooldown prevent repeated concurrent collection.
- Bounded same-host discovery: up to six relevant links per landing page per check. This is **not an exhaustive news archive**. Only pages mentioning Yntegra, Sampson Cay, Rosewood Exuma or Turtlegrass are retained.
- Explicit theme/phrase rules, canonical URL deduplication, first-seen and changed timestamps, review status, recent theme counts, source health, preserved HTML versions and SHA-256 hashes.
- Private, on-demand AI recommendations. Human edit + save + explicit publish required. Client API selects only published text; new drafts cannot replace it automatically. Source changes block publication until reviewed and saved again. Published recommendations show a source-change warning if subsequently outdated. Editor can withdraw a published recommendation.
- Editor-only snapshot export; exports are JSON to prevent archived HTML executing in the dashboard. Capture exports and editorial actions are logged. The archive is a source record, not a claim of legal admissibility.

## Deploy

1. In `worker`, install dependencies: `npm install`.
2. Use the existing Cloudflare deployment credentials: `npx wrangler login`.
3. Create the database: `npx wrangler d1 create sampson-cay-monitor`.
4. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the returned database ID.
5. Apply migration: `npx wrangler d1 migrations apply sampson-cay-monitor --remote`.
6. Reuse the existing DASHBOARD_AI_TOKEN for private editor access and set a **different**, randomly generated `MONITOR_CLIENT_TOKEN` with `npx wrangler secret put MONITOR_CLIENT_TOKEN`. Share only MONITOR_CLIENT_TOKEN with the client. If DASHBOARD_AI_TOKEN was previously shared with a client, rotate it before enabling private recommendations. These are shared role credentials, not individual user accounts; rotate them if exposed. Never embed either in HTML or repository files. The browser keeps tokens in memory only, and requires reconnection after reload.
7. Add the actual dashboard origin to ALLOWED_ORIGINS if it differs from GitHub Pages. CORS complements token authorization; it is not the permission boundary.
8. AI drafting reuses the existing OPENAI_API_KEY and OPENAI_MODEL, including the existing default if the model variable is absent. Do not create another AI setup. The monitor itself does not require AI credentials for collection or manually written recommendations.
9. Deploy: `npm run deploy`. Publish the root static files through the dashboard's existing hosting process.
10. Open `monitor.html`, connect to the existing Worker URL with editor credentials, and refresh. Connect separately with client credentials to verify that drafts remain invisible. Test each source's actual collection status; robots restrictions, changing layouts, limits and network errors are surfaced rather than bypassed.

## Editorial flow

Open an item → Generate AI draft (optional; incurs API usage) → edit → Save private draft → Publish to client. Publishing displays a confirmation. Saving without modifying the AI wording does not enable publication. Version checks reject stale saves and publish requests; updating a private draft leaves the previously published version visible. Publication is to the monitoring dashboard, not to social media.

## Coverage limits

Social collection is not connected: no Facebook/Instagram stories, reels, comments, private groups or engagement metrics. Our News has not been added without a verified crawlable source. Additional accounts need verified API/provider access before coverage can be promised. Theme counts are monitored-item counts, not population sentiment, reach or evidence of coordination. Sources are labelled as publishers, not as validated truth. Listings are also retained when relevant, so changes may reflect listing updates; always inspect the original source.

Collector removes script/navigation/footer/form elements before text comparison. Changes to retained page text can still include unrelated page furniture, so the UI labels them page updates rather than new allegations. Publication dates are extracted only from available page metadata, otherwise shown as unavailable. Raw captures are bounded to 1 MB; database retention/storage budgets should be reviewed before expanding the watchlist. Counsel should define any formal preservation requirements.

## Verification

`npm run check` and `npm test` in `worker`; `node --check monitor.js` at root. Tests use real SQLite for the D1-compatible SQL and cover client/editor isolation, unpublished draft exclusion, human edit gating, stale version/source rejection, withdrawal, robots and redirect/size restrictions. No live AI request is required. The D1 configuration uses an explicit placeholder until a real database is provisioned.
