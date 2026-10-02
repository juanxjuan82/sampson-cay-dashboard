# Communications dashboard

Overall opens with the executive read, three public-narrative cards, two social cards, the weekly plan and decisions needed. Facebook and Instagram show their respective metrics and post details. Supporting evidence includes the coverage log, theme classification, historical context and charts.

## Uploads

Upload one or more Meta CSV exports per platform. Standard Meta export filename ranges establish declared coverage, including days with no posts. The latest declared export is the default reporting window; dates can be changed in Overall. Unknown filename coverage disables prior-period percentage comparisons. Comparisons require at least five posts per platform in each equally sized window. These are lifetime snapshots, not equal-age performance comparisons.

Upload the article tracker as XLSX, or export Media Mentions as CSV. The workbook reader uses only the Media Mentions sheet, ignoring dashboard formulas and private campaign document tabs. Required columns: Publication Name, Article Title & URL (or Article Title/Title), Publish Date. Optional: Coverage Type, Reference, Opposition Articles, Theme, Article URL. Dates are native Excel dates, YYYY-MM-DD or MM/DD/YYYY. An upload replaces the previous tracker. Empty template rows are ignored; invalid rows and duplicates are reported. Deduplication uses outlet, date and headline. Workbook hyperlinks are retained when HTTP(S).

## AMEC evidence boundary

Coverage and reach are outputs; response measures include shares and saves. Audience understanding and trust are not measured. Separate editorial coverage, paid placements, public notices, releases and unclassified records. Reference identifies an actor, not sentiment. Headline topic matches can overlap and do not validate allegations or establish coordination. Tracker comparisons use the latest recorded fortnight, separately from the crawler's seven-day observations. Never add the two datasets together.

Social metrics remain platform-specific. Reach is not unique across posts or platforms. Facebook total clicks do not establish link clicks. Paid status is unverified. Comments are blocked and are not a success target. Condolence posts remain in performance records but are excluded from repeatable content candidates.

## Editorial control and publishing

Generate Strategy sends compact calculated evidence, strategy context and private coaching to the protected Worker. All narrative fields remain editable. Replacing evidence preserves actual edits and flags them for review. Export/publish asks for acknowledgement when evidence has changed. Generated output opens in edit mode and does not publish automatically.

Client exports retain normalized article rows, social history, selected reporting window, declared export ranges and edited narratives. They exclude coaching, account context and access tokens. Article import and date controls are hidden in the client report. Downloads do not save raw workbook files. Deploy the updated Worker for the expanded strategy response fields; the dashboard tolerates the older five-field response until deployment.

## Validation

Run `npm run check`, `npm test` and `npx wrangler deploy --dry-run` in worker. AMEC regressions cover mixed coverage types, invalid dates, deduplication, URL validation, known/unknown social coverage and independent article periods. Browser verification includes real XLSX/CSV uploads, tab switching, edit persistence, client export privacy and mobile layout.
