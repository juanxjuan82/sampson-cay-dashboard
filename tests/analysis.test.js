const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../js/analysis.js');

const igHeaders = ['Post ID', 'Account username', 'Description', 'Permalink', 'Post type', 'Publish time', 'Views', 'Reach', 'Likes', 'Shares', 'Follows', 'Comments', 'Saves'];
const fbHeaders = ['Post ID', 'Page name', 'Title', 'Description', 'Post type', 'Publish time', 'Is crosspost', 'Reach', 'Views', 'Reactions', 'Comments', 'Shares', 'Total clicks'];

function igRow(id, date, reach, likes, type = 'IG reel', caption = 'Our community') {
  return { 'Post ID': id, 'Account username': 'sampsoncay', Description: caption, Permalink: `https://instagram.com/p/${id}/`, 'Post type': type, 'Publish time': `${date} 09:15`, Views: reach * 2, Reach: reach, Likes: likes, Shares: 1, Follows: 0, Comments: 1, Saves: 0 };
}

test('detects Instagram and Facebook exports and parses metrics', () => {
  const ig = SC.parseSocialRows([igRow('1', '08/29/2025', 200, 18)], igHeaders);
  assert.equal(ig.platform, 'ig');
  assert.equal(ig.posts[0].date, '2025-08-29');
  assert.equal(ig.posts[0].hour, 9);
  assert.equal(ig.posts[0].format, 'Reel');
  assert.equal(ig.posts[0].interactions, 20);

  const fb = SC.parseSocialRows([
    { 'Post ID': '9', 'Page name': 'Sampson Cay', Description: 'Jobs fair', 'Post type': 'Photos', 'Publish time': '09/01/2025 10:00', 'Is crosspost': '0', Reach: '1,000', Reactions: 10, Comments: 2, Shares: 3 },
    { 'Post ID': '10', 'Page name': 'Sampson Cay', 'Post type': 'Photos', 'Publish time': '09/02/2025 10:00', 'Is crosspost': '1', Reach: 50 },
  ], fbHeaders);
  assert.equal(fb.platform, 'fb');
  assert.equal(fb.posts.length, 2, 'crossposts are kept: their Facebook numbers are Facebook-only');
  assert.equal(fb.posts[0].reach, 1000);
  assert.equal(fb.posts[0].format, 'Image');
  assert.equal(fb.posts[0].interactions, 15);
});

test('unknown CSVs are rejected rather than guessed', () => {
  const result = SC.parseSocialRows([{ Foo: 1 }], ['Foo']);
  assert.equal(result.platform, null);
});

test('re-uploading merges by permalink instead of duplicating', () => {
  const first = SC.parseSocialRows([igRow('1', '08/29/2025', 200, 18), igRow('2', '08/30/2025', 100, 5)], igHeaders).posts;
  const legacy = SC.fromLegacyPost({ platform: 'ig', type: 'IG reel', dateStr: '08/29/2025', reach: 150, interactions: 10, caption: 'x', permalink: 'https://instagram.com/p/1/' });
  let merged = SC.mergePosts([legacy], first);
  assert.equal(merged.posts.length, 2);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  const refreshed = SC.parseSocialRows([igRow('1', '08/29/2025', 400, 30)], igHeaders).posts;
  merged = SC.mergePosts(merged.posts, refreshed);
  assert.equal(merged.posts.length, 2);
  assert.equal(merged.posts.find(p => p.permalink.endsWith('/1/')).reach, 400, 'newest upload wins');
});

test('media records parse, dedupe and merge into history', () => {
  const first = SC.parseMediaRecords([
    { 'Article Title & URL': 'Project wins approval', 'Publication Name': 'The Tribune', 'Publish Date': 46297, 'Coverage Type': 'Article' },
    { 'Article Title & URL': 'Project wins approval', 'Publication Name': 'Tribune', 'Publish Date': '2026-10-02' },
    { 'Article Title & URL': 'No outlet', 'Publish Date': '2026-10-02' },
    { 'Article Title & URL': '', 'Publication Name': '', 'Publish Date': '' },
  ]);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].date, '2026-10-02');
  assert.equal(first.duplicates, 1);
  assert.equal(first.skipped, 1);
  const second = SC.parseMediaRecords([
    { Headline: 'Project wins approval', Outlet: 'The Tribune', Date: '10/02/2026' },
    { Headline: 'Community meeting', Outlet: 'EyeWitness News', Date: '10/03/2026' },
  ]);
  const merged = SC.mergeMedia(first.items, second.items);
  assert.equal(merged.media.length, 2);
  assert.equal(merged.added, 1);
});

test('dates: rejects impossible dates, handles Excel serials', () => {
  assert.equal(SC.parseDate('02/30/2026'), '');
  assert.equal(SC.parseDate(46297), '2026-10-02');
  assert.equal(SC.parseDate('2026-10-02T04:00:00.000Z'), '2026-10-02');
});

function sampleData() {
  const posts = [];
  for (let i = 0; i < 40; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = i < 20 ? '06' : '08';
    const type = i % 2 ? 'IG reel' : 'IG image';
    const caption = i % 2 ? 'Local jobs and training for Bahamian workers' : 'Protecting seagrass and marine habitat';
    posts.push(...SC.parseSocialRows([igRow(String(i), `${month}/${day}/2026`, 100 + i * 10, i % 2 ? 12 : 4, type, caption)], igHeaders).posts);
  }
  const media = SC.parseMediaRecords([
    { Title: 'A', Outlet: 'The Tribune', Date: '2026-08-10', Sentiment: 'positive' },
    { Title: 'B', Outlet: 'The Tribune', Date: '2026-08-10', Sentiment: 'negative' },
    { Title: 'C', Outlet: 'Nassau Guardian', Date: '2026-08-20' },
    { Title: 'D', Outlet: 'The Tribune', Date: '2026-06-01' },
  ]).items;
  return { posts, media };
}

test('analysis covers period totals, comparison, formats, themes and media', () => {
  const stats = SC.analyze(sampleData(), '90');
  assert.equal(stats.empty, false);
  assert.equal(stats.range.end, '2026-08-28');
  assert.equal(stats.totals.posts, 40);
  assert.ok(stats.formats.find(f => f.label === 'Instagram Reel'));
  assert.ok(stats.themes.find(t => t.label === 'Economy'));
  assert.ok(stats.themes.find(t => t.label === 'Environment'));
  assert.equal(stats.media.total, 4);
  assert.equal(stats.media.outlets[0].label, 'The Tribune');
  assert.equal(stats.media.moments[0].date, '2026-08-20');

  const month = SC.analyze(sampleData(), '30');
  assert.equal(month.totals.posts, 20);
  assert.ok(month.previousTotals === null || month.previousTotals.posts >= 0);
  assert.equal(month.media.total, 3);
});

test('summary, narrative and AI evidence are produced in plain language', () => {
  const stats = SC.analyze(sampleData(), 'all');
  const summary = SC.buildSummary(stats);
  assert.match(summary.overview, /40 posts/);
  assert.match(summary.working, /Instagram Reel/);
  assert.ok(summary.recommendations.length >= 2);
  const narrative = SC.mediaNarrative(stats);
  assert.match(narrative, /4 times across 2 outlets/);
  assert.match(narrative, /The Tribune \(3\)/);
  const evidence = SC.buildAIEvidence(stats);
  assert.equal(evidence.media.total, 4);
  assert.ok(JSON.stringify(evidence).length < 100000, 'fits the AI worker size limit');
});

test('no data gives an empty result instead of crashing', () => {
  assert.equal(SC.analyze({ posts: [], media: [] }, '90').empty, true);
  assert.equal(SC.buildSummary({ empty: true }), null);
});

test('saved dashboard data loads and analyses cleanly', () => {
  const data = require('../data/dashboard.json');
  assert.ok(data.posts.length > 0);
  const stats = SC.analyze(data, 'all');
  assert.ok(stats.totals.reach > 0);
  assert.ok(SC.buildSummary(stats).overview.length > 50);
});

test('best-time-to-post converts Meta export times (Pacific) to Bahamas time', () => {
  // Exported as 4am Pacific on Wed Sep 30, 2026 → 7am Bahamas, same day.
  assert.deepEqual(SC.bahamasDayAndHour({ date: '2026-09-30', hour: 4 }), { day: 3, hour: 7 });
  // 10pm Pacific Saturday → 1am Bahamas on Sunday.
  assert.deepEqual(SC.bahamasDayAndHour({ date: '2026-10-03', hour: 22 }), { day: 0, hour: 1 });
  const map = SC.postingHeatmap([
    { date: '2026-09-30', hour: 4, reach: 100, interactions: 5 },
    { date: '2026-09-30', hour: 5, reach: 100, interactions: 7 },
  ]);
  assert.equal(map.cells[0][3].posts, 2, 'both land in the early (before 9am) Wednesday cell');
});

test('boosted posts are detected from reach and kept out of organic comparisons', () => {
  const posts = [];
  for (let i = 0; i < 10; i += 1) {
    posts.push(...SC.parseSocialRows([igRow('o' + i, `09/${String(i + 1).padStart(2, '0')}/2026`, 120 + i, 9, 'IG carousel')], igHeaders).posts);
  }
  posts.push(...SC.parseSocialRows([igRow('p1', '09/20/2026', 15000, 30, 'IG reel'), igRow('p2', '09/21/2026', 9000, 20, 'IG reel'), igRow('p3', '09/22/2026', 4000, 10, 'IG reel')], igHeaders).posts);
  const stats = SC.analyze({ posts, media: [] }, 'all');
  assert.equal(stats.boostedCount, 3);
  assert.ok(stats.paid.reachShare > 0.9);
  assert.ok(!stats.formats.find(f => f.label === 'Instagram Reel'), 'boosted reels are not in the organic format stats');
  const summary = SC.buildSummary(stats);
  assert.match(summary.overview, /Boosting drove almost all/);
  assert.match(summary.attention, /Boosted posts bought reach but little interaction/);
  assert.match(summary.recommendations[0], /Boost selectively/);
});
