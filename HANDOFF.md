# Handoff: rebuild the Sampson Cay dashboard (simple version)

## Why
`index.html` on `main` (~4,800 lines) is overbuilt. It assumes a Replit backend ("sign in with an administrator account", "saved CSV data") that is not in this repo. It also copies its own rendered page back into GitHub ("Sync source"). Because of that, the uploader and the Media Narrative / Key Moments cards don't show reliably on GitHub Pages. Replace it with a small static site. **No backend, no build step.**

## What the client needs (only this)
1. **Upload CSVs**: Facebook and Instagram post exports from Meta Business Suite. Detect the platform from the headers.
2. **Save them** so nobody has to re-upload:
   - Auto-save to the browser (localStorage, wrapped in try/catch).
   - A **"Save to website"** button writes `data/dashboard.json` to the repo via the GitHub Contents API (GET the file's `sha` first, then PUT). Reuse the existing localStorage key `gh_settings` (`{token, repo}`, default repo `juanxjuan82/sampson-cay-dashboard`) so the client's saved token keeps working.
   - On load: read `data/dashboard.json?t=<now>`. If the browser copy has a newer `savedAt`, use it and show "Unsaved changes. Click Save to website."
   - New uploads **merge** into history (dedupe by post ID; the newer upload wins). The client can upload only the latest 90 days and history keeps building.
3. **Upload PR activity** (`.xlsx` with a sheet named "Media Mentions", or a `.csv`). Merge into a growing media-coverage history, deduped by outlet + date + title. Add a "Clear media history" button.
4. **Executive summary + analysis + recommendations**:
   - Always generated automatically from the data (no AI needed).
   - The admin can edit the text and the edits are saved.
   - Optional "Rewrite with AI" button posts to the existing Cloudflare Worker (`worker/src/index.js`, `POST /summary`, `Authorization: Bearer <token>`). It returns `performanceOverview`, `whatsWorking`, `whatsNotWorking`, `recommendedDirection`. Reuse the localStorage keys `dashboard_ai_endpoint` and `dashboard_ai_context`. Update the worker prompt so it covers media coverage as well as social. It currently forces Community/Economy/Environment/Site Activity theme framing; loosen that.
5. **Media Narrative + Key Moments cards** must always render when media data exists, on both the admin and client pages.

## Already done on this branch
- `js/analysis.js`: complete, framework-free logic. Use it, don't rewrite it. It exposes `window.SC`, or `module.exports` in Node. Main functions:
  - `parseSocialRows(rows, headers)` → `{platform, posts, skipped}`
  - `parseMediaRecords(records)` → `{items, skipped, duplicates}`
  - `mergePosts`, `mergeMedia`
  - `fromLegacyPost` converts posts from the old embedded report format
  - `analyze(data, periodId)` with `periodId` = `'30' | '90' | '365' | 'all'`. Returns totals, % changes vs the previous period, format/theme stats (organic posts only, likely-boosted posts flagged), top posts, monthly series, and a media analysis (outlets, themes, sentiment, key moments).
  - `mediaNarrative(stats)` → paragraph text
  - `buildSummary(stats)` → `{overview, working, attention, recommendations[]}`
  - `buildAIEvidence(stats)` → payload for the worker
- `vendor/`: local copies of Chart.js 4.4.1, PapaParse 5.4.1 and SheetJS. Load these instead of CDNs.

## Still to build
- `index.html` (admin) and `report.html` (client, read-only), sharing `css/style.css` and `js/app.js`. Use `<body data-mode="admin|client">` to hide the upload/save/edit controls on the client page.
- Layout:
  - Header with the date range
  - Period picker
  - KPI cards: posts, reach, views, engagement rate, media mentions, outlets
  - Executive summary (4 blocks)
  - Social section: monthly reach chart by platform, format table, top-10 posts
  - Media section: Narrative card, Key Moments card, mentions-per-month chart, top outlets, full searchable coverage table with links
- Seed `data/dashboard.json` from the current `report.html`. Its `window.__EMBEDDED_DATA__` has 163 IG + 152 FB posts; convert them with `fromLegacyPost`. **Do not** import its `articleTracker`, because it only holds 10 of 455 rows. The PR workbook needs one re-upload.
- `data/dashboard.json` shape: `{ version: 1, savedAt, posts: [], media: [], summary: null | {period, overview, working, attention, recommendations, source: 'auto-edited'|'ai'} }`
- Escape all user/CSV text before inserting it as HTML.
- Replace `worker/test/static-amec-regression.test.js` (it greps the old HTML) with `node --test` tests for `js/analysis.js`.
- Remove the Replit analytics script tag. Leave `client.html` alone.
- The page must work at phone width.

## Data formats
- **Instagram CSV** columns: Post ID, Account username, Description, Permalink, Post type (IG reel/IG image/IG carousel), Publish time (`MM/DD/YYYY HH:MM`), Views, Reach, Likes, Shares, Follows, Comments, Saves.
- **Facebook CSV** columns: Post ID, Page name, Title, Description, Post type (Photos/Videos/Reels/Links), Publish time, Is crosspost (skip `1`), Reach, Views, Reactions, Comments, Shares, Total clicks.
- **PR workbook**, sheet "Media Mentions":
  - Article Title & URL (the title cell may hold a hyperlink; read `cell.l.Target` into the URL)
  - Publication Name
  - Publish Date (Excel serial or text)
  - Coverage Type
  - Theme (optional)
  - Sentiment (optional)
