# Sampson Cay dashboard

A simple static site (GitHub Pages). No server and no build step.

| Page | Who it's for |
|---|---|
| `index.html` | You: upload data, edit the summary, save |
| `report.html` | The client: same dashboard, read-only |

## Everyday use
1. Open `index.html`.
2. Upload the Facebook / Instagram CSV exports from Meta Business Suite. Several files at once is fine.
3. Upload the PR activity workbook (`.xlsx` with a "Media Mentions" sheet).
4. Uploads are **added to the saved history**. Uploading the same posts or articles again updates them; it never duplicates them. You only need to upload what's new.
5. Optionally edit the executive summary, or use "Rewrite with AI".
6. Click **Save to website**. This writes `data/dashboard.json` to GitHub, so the client report and every other computer see the update about a minute later.

The first time you save, add a GitHub token in **Settings**. Use a fine-grained token with *Contents: read and write* on this repository.

Until you click Save, changes are kept only in the browser you're using.

## Files
- `js/analysis.js`: reads the files and does all the numbers, the summary and the recommendations.
- `js/app.js`: the page (uploads, saving, charts, tables).
- `css/style.css`: styling.
- `data/dashboard.json`: the saved data.
- `worker/`: optional Cloudflare Worker for the "Rewrite with AI" button.
- `tests/`: run `npm test`.
