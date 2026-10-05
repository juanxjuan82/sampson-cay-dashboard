// Sampson Cay dashboard — data parsing and analysis.
// Plain functions with no page access, so they can also be tested in Node.
(function (root) {
  'use strict';

  const DAY = 86400000;

  // ── Small helpers ──────────────────────────────────────────────
  function num(value) {
    if (value === undefined || value === null || value === '' || value === 'N/A') return 0;
    const parsed = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function sum(values) {
    return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  }

  function countBy(items, getKey) {
    const counts = new Map();
    items.forEach(item => {
      const key = getKey(item);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function isoDate(year, month, day) {
    const key = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
    const check = new Date(key + 'T00:00:00Z');
    return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === key ? key : '';
  }

  function dateToMs(date) {
    return Date.parse(date + 'T00:00:00Z');
  }

  function msToDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Accepts "08/29/2025 06:12", "2025-08-29", "2025-08-29T04:00:00Z", Excel serial numbers and Date objects.
  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      return msToDate(Math.round((value - 25569) * DAY));
    }
    const text = String(value || '').trim();
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) return isoDate(match[1], match[2], match[3]);
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (match) {
      const year = match[3].length === 2 ? '20' + match[3] : match[3];
      return isoDate(year, match[1], match[2]);
    }
    const parsed = new Date(text);
    return text && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
  }

  function monthKey(date) {
    return date.slice(0, 7);
  }

  function monthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function formatDate(date) {
    if (!date) return '';
    return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function formatNumber(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.round(n).toLocaleString('en-US');
  }

  function formatPct(value) {
    return (Number(value) || 0).toFixed(1) + '%';
  }

  // ── Social CSV parsing (Meta Business Suite exports) ───────────
  const FORMAT_NAMES = {
    'ig reel': 'Reel', 'reels': 'Reel', 'reel': 'Reel',
    'ig image': 'Image', 'photos': 'Image', 'photo': 'Image', 'image': 'Image',
    'ig carousel': 'Carousel', 'carousel': 'Carousel', 'carousel_album': 'Carousel',
    'videos': 'Video', 'video': 'Video',
    'links': 'Link', 'link': 'Link',
    'status': 'Text', 'text': 'Text',
  };

  function normalizeFormat(type) {
    const key = String(type || '').trim().toLowerCase();
    return FORMAT_NAMES[key] || (key ? key.replace(/^ig\s+/, '').replace(/^\w/, c => c.toUpperCase()) : 'Other');
  }

  function detectPlatform(headers) {
    const set = new Set(headers.map(h => String(h).trim()));
    if (set.has('Account username') || set.has('Saves')) return 'ig';
    if (set.has('Page name') || set.has('Reactions') || set.has('Is crosspost')) return 'fb';
    return null;
  }

  function hourFrom(value) {
    const match = String(value || '').match(/\s(\d{1,2}):\d{2}/);
    return match ? Number(match[1]) : null;
  }

  // rows: array of objects keyed by CSV header. Returns { platform, posts, skipped }.
  function parseSocialRows(rows, headers) {
    const platform = detectPlatform(headers || Object.keys(rows[0] || {}));
    if (!platform) return { platform: null, posts: [], skipped: rows.length };
    const posts = [];
    let skipped = 0;
    rows.forEach(row => {
      const id = String(row['Post ID'] || '').trim();
      const date = parseDate(row['Publish time']);
      if (!id || !date || (platform === 'fb' && String(row['Is crosspost']).trim() === '1')) {
        skipped += 1;
        return;
      }
      const reach = num(row.Reach);
      const comments = num(row.Comments);
      const shares = num(row.Shares);
      const post = {
        id: platform + ':' + id,
        platform,
        format: normalizeFormat(row['Post type']),
        date,
        hour: hourFrom(row['Publish time']),
        reach,
        views: num(row.Views),
        comments,
        shares,
        caption: String(row.Description || row.Title || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
        permalink: String(row.Permalink || '').trim(),
      };
      if (platform === 'ig') {
        post.likes = num(row.Likes);
        post.saves = num(row.Saves);
        post.follows = num(row.Follows);
        post.interactions = post.likes + comments + shares + post.saves;
      } else {
        post.reactions = num(row.Reactions);
        post.clicks = num(row['Total clicks']);
        post.interactions = post.reactions + comments + shares;
      }
      posts.push(post);
    });
    return { platform, posts, skipped };
  }

  // Converts posts saved by the previous dashboard version into the current shape.
  function fromLegacyPost(post) {
    const date = parseDate(post.dateStr || post.date);
    const id = post.permalink || [post.platform, date, post.hour, String(post.caption || '').slice(0, 60)].join('|');
    return {
      id: post.platform + ':' + id,
      platform: post.platform,
      format: normalizeFormat(post.type),
      date,
      hour: Number.isFinite(post.hour) ? post.hour : null,
      reach: num(post.reach),
      views: num(post.views),
      comments: num(post.comments),
      shares: num(post.shares),
      likes: post.platform === 'ig' ? num(post.likes) : undefined,
      saves: post.platform === 'ig' ? num(post.saves) : undefined,
      follows: post.platform === 'ig' ? num(post.follows) : undefined,
      reactions: post.platform === 'fb' ? num(post.reactions) : undefined,
      clicks: post.platform === 'fb' ? num(post.totalClicks) : undefined,
      interactions: num(post.interactions),
      caption: String(post.caption || ''),
      permalink: String(post.permalink || ''),
    };
  }

  // ── PR / media coverage parsing ────────────────────────────────
  function pick(record, names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(record, name) && String(record[name]).trim() !== '') return record[name];
    }
    // Case-insensitive fallback.
    const lower = Object.keys(record).reduce((map, key) => { map[key.trim().toLowerCase()] = key; return map; }, {});
    for (const name of names) {
      const key = lower[name.toLowerCase()];
      if (key && String(record[key]).trim() !== '') return record[key];
    }
    return '';
  }

  function mediaKey(item) {
    return [item.outlet.toLowerCase().replace(/^the\s+/, '').trim(), item.date, item.title.toLowerCase().trim()].join('|');
  }

  // records: array of objects keyed by column header. Returns { items, skipped, duplicates }.
  function parseMediaRecords(records) {
    const items = [];
    const seen = new Set();
    let skipped = 0;
    let duplicates = 0;
    records.forEach(record => {
      const title = String(pick(record, ['Article Title & URL', 'Article Title', 'Title', 'Headline'])).trim();
      const outlet = String(pick(record, ['Publication Name', 'Publication', 'Outlet', 'Media Outlet', 'Source'])).trim();
      const date = parseDate(pick(record, ['Publish Date', 'Date', 'Published', 'Publication Date']));
      if (!title && !outlet && !date) return;
      if (!title || !outlet || !date) { skipped += 1; return; }
      const item = {
        date,
        outlet: outlet.slice(0, 200),
        title: title.slice(0, 500),
        url: String(pick(record, ['Article URL', 'URL', 'Link'])).trim().slice(0, 2000),
        type: String(pick(record, ['Coverage Type', 'Type', 'Media Type'])).trim().slice(0, 100),
        theme: String(pick(record, ['Theme', 'Pillar', 'Topic'])).trim().slice(0, 150),
        sentiment: String(pick(record, ['Sentiment', 'Tone'])).trim().slice(0, 40),
      };
      const key = mediaKey(item);
      if (seen.has(key)) { duplicates += 1; return; }
      seen.add(key);
      items.push(item);
    });
    return { items, skipped, duplicates };
  }

  // ── Merging uploads into saved history ─────────────────────────
  // Newer uploads replace older copies of the same post (metrics keep growing after posting).
  // Posts are matched on their permalink when there is one, so posts carried over
  // from the old dashboard (which had no Post ID) still match fresh CSV uploads.
  function postKey(post) {
    const link = String(post.permalink || '').trim().replace(/\/+$/, '').toLowerCase();
    return link ? post.platform + '|' + link : post.id;
  }

  function mergePosts(existing, incoming) {
    const byId = new Map(existing.map(post => [postKey(post), post]));
    let added = 0;
    let updated = 0;
    incoming.forEach(post => {
      const key = postKey(post);
      if (byId.has(key)) updated += 1; else added += 1;
      byId.set(key, post);
    });
    const posts = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { posts, added, updated };
  }

  function mergeMedia(existing, incoming) {
    const byKey = new Map(existing.map(item => [mediaKey(item), item]));
    let added = 0;
    incoming.forEach(item => {
      if (!byKey.has(mediaKey(item))) added += 1;
      byKey.set(mediaKey(item), item);
    });
    const media = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.outlet.localeCompare(b.outlet));
    return { media, added };
  }

  // ── Content themes (keyword tagging of captions) ───────────────
  // Same keyword weights as the original dashboard. A post gets the theme with the
  // strongest score (minimum 4); "Site Activity" uses specific phrases from June 2026 on.
  const THEMES = [
    { id: 'community', label: 'Community', color: '#0d5a6c', terms: [
      ['community', 4], ['communities', 4], ['local residents', 4], ['resident', 3], ['residents', 3],
      ['family', 2], ['families', 2], ['youth', 3], ['student', 2], ['students', 2],
      ['neighbourhood', 3], ['neighborhood', 3], ['volunteer', 3], ['donation', 3],
      ['community centre', 4], ['community center', 4], ['local people', 3], ['bahamian community', 4],
      ['partnership', 1], ['support', 1], ['people', 1]] },
    { id: 'economy', label: 'Economy', color: '#b7791f', terms: [
      ['economy', 4], ['economic', 4], ['job', 4], ['jobs', 4], ['employment', 4], ['employed', 3],
      ['workforce', 3], ['career', 3], ['careers', 3], ['hiring', 4], ['business', 2], ['businesses', 2],
      ['local business', 4], ['vendor', 3], ['vendors', 3], ['supplier', 3], ['suppliers', 3],
      ['contractor', 2], ['contractors', 2], ['investment', 3], ['tourism', 3],
      ['opportunity', 2], ['opportunities', 2], ['livelihood', 3], ['commerce', 3]] },
    { id: 'environment', label: 'Environment', color: '#2f855a', terms: [
      ['environment', 4], ['environmental', 4], ['sustainability', 4], ['sustainable', 4],
      ['conservation', 4], ['marine', 3], ['ocean', 3], ['sea', 2], ['coast', 2], ['coastal', 3],
      ['wildlife', 3], ['habitat', 3], ['ecosystem', 3], ['biodiversity', 4], ['coral', 3],
      ['mangrove', 3], ['mangroves', 3], ['turtle', 3], ['turtles', 3], ['turtlegrass', 4],
      ['seagrass', 4], ['climate', 3], ['water quality', 4], ['waste', 2], ['renewable', 3],
      ['solar', 3], ['nature', 2], ['ecological', 4]] },
    { id: 'site', label: 'Site Activity', color: '#4c51bf', terms: [] },
  ];
  const OTHER_THEME = { id: 'other', label: 'Other', color: '#94a3b8' };
  const SITE_ACTIVITY_FROM = '2026-06-01';
  const SITE_ACTIVITY_PHRASES = [
    'detailed land and habitat surveys', 'mapping critical habitats', 'tracking bird life',
    'recording the natural soundscape', 'sound readings', 'collecting sound data',
    'preparatory work has begun', 'early site preparation', 'advancing our site preparation',
  ];

  function themeText(value) {
    return ' ' + String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  function tagTheme(caption, date) {
    const text = themeText(caption);
    if (date && date >= SITE_ACTIVITY_FROM && !/ black point community cent(er|re) /.test(text) &&
        SITE_ACTIVITY_PHRASES.some(phrase => text.includes(themeText(phrase)))) {
      return 'Site Activity';
    }
    let best = null;
    THEMES.forEach(theme => {
      const score = theme.terms.reduce((total, [term, weight]) => total + (text.includes(themeText(term)) ? weight : 0), 0);
      if (score >= 4 && (!best || score > best.score)) best = { label: theme.label, score };
    });
    return best ? best.label : OTHER_THEME.label;
  }

  function themeColor(label) {
    return (THEMES.find(t => t.label === label) || OTHER_THEME).color;
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TIME_BLOCKS = [
    { label: 'Early (before 9am)', from: 0, to: 8 },
    { label: 'Morning (9–12)', from: 9, to: 11 },
    { label: 'Afternoon (12–5)', from: 12, to: 16 },
    { label: 'Evening (5pm+)', from: 17, to: 23 },
  ];

  // Median engagement for each weekday × time-of-day block.
  function postingHeatmap(posts) {
    const cells = TIME_BLOCKS.map(() => WEEKDAYS.map(() => []));
    posts.forEach(post => {
      if (!Number.isInteger(post.hour) || post.reach <= 0) return;
      const block = TIME_BLOCKS.findIndex(b => post.hour >= b.from && post.hour <= b.to);
      const day = new Date(post.date + 'T00:00:00Z').getUTCDay();
      if (block >= 0) cells[block][day].push((post.interactions / post.reach) * 100);
    });
    return {
      days: WEEKDAYS,
      blocks: TIME_BLOCKS.map(b => b.label),
      cells: cells.map(row => row.map(values => ({ posts: values.length, medianEngagement: values.length ? median(values) : null }))),
    };
  }

  // ── Analysis ───────────────────────────────────────────────────
  const PERIODS = {
    '30': { days: 30, label: 'Last 30 days' },
    '90': { days: 90, label: 'Last 90 days' },
    '365': { days: 365, label: 'Last 12 months' },
    'all': { days: null, label: 'All time' },
  };

  function latestDate(data) {
    const dates = [...(data.posts || []).map(p => p.date), ...(data.media || []).map(m => m.date)].filter(Boolean).sort();
    return dates[dates.length - 1] || null;
  }

  function earliestDate(data) {
    const dates = [...(data.posts || []).map(p => p.date), ...(data.media || []).map(m => m.date)].filter(Boolean).sort();
    return dates[0] || null;
  }

  function periodRange(data, periodId) {
    const end = latestDate(data);
    if (!end) return null;
    const period = PERIODS[periodId] || PERIODS.all;
    if (!period.days) return { id: 'all', label: period.label, start: earliestDate(data), end, previous: null };
    const endMs = dateToMs(end);
    const start = msToDate(endMs - (period.days - 1) * DAY);
    const previous = {
      start: msToDate(endMs - (2 * period.days - 1) * DAY),
      end: msToDate(endMs - period.days * DAY),
    };
    return { id: periodId, label: period.label, start, end, previous };
  }

  function inRange(date, range) {
    return range && date >= range.start && date <= range.end;
  }

  function engagementRate(posts) {
    const reach = sum(posts.map(p => p.reach));
    return reach > 0 ? (sum(posts.map(p => p.interactions)) / reach) * 100 : 0;
  }

  function socialTotals(posts) {
    return {
      posts: posts.length,
      reach: sum(posts.map(p => p.reach)),
      views: sum(posts.map(p => p.views)),
      interactions: sum(posts.map(p => p.interactions)),
      engagementRate: engagementRate(posts),
      follows: sum(posts.map(p => p.follows || 0)),
    };
  }

  // Posts with reach far above the platform's usual level were most likely boosted (paid).
  function markBoosted(posts) {
    const medians = {};
    ['ig', 'fb'].forEach(platform => {
      medians[platform] = median(posts.filter(p => p.platform === platform && p.reach > 0).map(p => p.reach));
    });
    return posts.map(p => ({ ...p, boosted: medians[p.platform] > 0 && p.reach > medians[p.platform] * 4 }));
  }

  function groupStats(posts, getKey, minPosts) {
    const groups = new Map();
    posts.forEach(post => {
      const key = getKey(post);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(post);
    });
    return [...groups.entries()].map(([label, items]) => ({
      label,
      posts: items.length,
      medianReach: median(items.map(p => p.reach)),
      medianEngagement: median(items.filter(p => p.reach > 0).map(p => (p.interactions / p.reach) * 100)),
      totalReach: sum(items.map(p => p.reach)),
      avgComments: sum(items.map(p => p.comments || 0)) / items.length,
      avgShares: sum(items.map(p => p.shares || 0)) / items.length,
      avgSaves: items.some(p => p.platform === 'ig') ? sum(items.map(p => p.saves || 0)) / items.length : null,
      followsPerPost: items.some(p => p.platform === 'ig') ? sum(items.map(p => p.follows || 0)) / items.length : null,
      bestPost: items.filter(p => p.reach >= 50).sort((x, y) => (y.interactions / y.reach) - (x.interactions / x.reach))[0] || null,
      reliable: items.length >= minPosts,
    })).sort((a, b) => b.posts - a.posts);
  }

  function pctChange(current, previous) {
    if (!previous) return null;
    return ((current - previous) / previous) * 100;
  }

  function longestGapDays(posts, range) {
    const dates = [...new Set(posts.map(p => p.date))].sort();
    if (!dates.length) return null;
    let longest = { days: 0, from: null, to: null };
    for (let i = 1; i < dates.length; i += 1) {
      const days = (dateToMs(dates[i]) - dateToMs(dates[i - 1])) / DAY;
      if (days > longest.days) longest = { days, from: dates[i - 1], to: dates[i] };
    }
    return longest;
  }

  function mediaAnalysis(items, previousItems) {
    const months = countBy(items, item => monthKey(item.date)).sort((a, b) => a.label.localeCompare(b.label));
    const busiestMonth = months.slice().sort((a, b) => b.count - a.count)[0] || null;
    // Key moments: the days with the most coverage, then the newest items.
    const byDay = new Map();
    items.forEach(item => {
      if (!byDay.has(item.date)) byDay.set(item.date, []);
      byDay.get(item.date).push(item);
    });
    const moments = [...byDay.entries()]
      .map(([date, dayItems]) => ({ date, count: dayItems.length, outlets: [...new Set(dayItems.map(i => i.outlet))], items: dayItems }))
      .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))
      .slice(0, 5)
      .sort((a, b) => b.date.localeCompare(a.date));
    const outlets = countBy(items, item => item.outlet);
    const previousOutlets = new Set((previousItems || []).map(item => item.outlet.toLowerCase()));
    const sentiments = countBy(items, item => item.sentiment ? item.sentiment.replace(/^\w/, c => c.toUpperCase()) : '');
    return {
      total: items.length,
      previousTotal: previousItems ? previousItems.length : null,
      outletCount: outlets.length,
      outlets,
      newOutlets: previousItems ? outlets.filter(o => !previousOutlets.has(o.label.toLowerCase())).map(o => o.label) : [],
      types: countBy(items, item => item.type),
      themes: countBy(items, item => item.theme),
      sentiments,
      months,
      busiestMonth,
      moments,
      latest: items.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      first: items.length ? items.reduce((min, item) => item.date < min ? item.date : min, items[0].date) : null,
      last: items.length ? items.reduce((max, item) => item.date > max ? item.date : max, items[0].date) : null,
    };
  }

  function analyze(data, periodId) {
    const range = periodRange(data, periodId);
    const allPosts = markBoosted((data.posts || []).map(p => ({ ...p, theme: tagTheme(p.caption, p.date) })));
    const media = data.media || [];
    if (!range) return { empty: true };

    const posts = allPosts.filter(p => inRange(p.date, range));
    const previousPosts = range.previous ? allPosts.filter(p => inRange(p.date, range.previous)) : null;
    const organic = posts.filter(p => !p.boosted);
    const mediaItems = media.filter(m => inRange(m.date, range));
    const previousMedia = range.previous ? media.filter(m => inRange(m.date, range.previous)) : null;

    const totals = socialTotals(posts);
    const previousTotals = previousPosts && previousPosts.length ? socialTotals(previousPosts) : null;
    const byPlatform = {
      ig: socialTotals(posts.filter(p => p.platform === 'ig')),
      fb: socialTotals(posts.filter(p => p.platform === 'fb')),
    };

    const ranked = posts.filter(p => p.reach >= 50).map(p => ({ ...p, engagementRate: (p.interactions / p.reach) * 100 }));
    const topPosts = ranked.slice().sort((a, b) => b.engagementRate - a.engagementRate).slice(0, 10);
    const topReach = posts.slice().sort((a, b) => b.reach - a.reach).slice(0, 5);

    const monthly = new Map();
    posts.forEach(p => {
      const key = monthKey(p.date);
      if (!monthly.has(key)) monthly.set(key, { month: key, igReach: 0, fbReach: 0, posts: 0, interactions: 0, reach: 0 });
      const row = monthly.get(key);
      row[p.platform + 'Reach'] += p.reach;
      row.posts += 1;
      row.reach += p.reach;
      row.interactions += p.interactions;
    });
    mediaItems.forEach(m => {
      const key = monthKey(m.date);
      if (!monthly.has(key)) monthly.set(key, { month: key, igReach: 0, fbReach: 0, posts: 0, interactions: 0, reach: 0 });
    });
    const monthlyRows = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).map(row => ({
      ...row,
      label: monthLabel(row.month),
      mentions: mediaItems.filter(m => monthKey(m.date) === row.month).length,
    }));

    const weeks = Math.max(1, ((dateToMs(range.end) - dateToMs(range.start)) / DAY + 1) / 7);

    return {
      empty: false,
      range,
      totals,
      previousTotals,
      byPlatform,
      postsPerWeek: posts.length / weeks,
      boostedCount: posts.filter(p => p.boosted).length,
      formats: groupStats(organic, p => (p.platform === 'ig' ? 'Instagram ' : 'Facebook ') + p.format, 3),
      themes: groupStats(organic, p => p.theme, 3),
      themeCounts: countBy(posts, p => p.theme),
      contentMix: countBy(posts, p => (p.platform === 'ig' ? 'Instagram ' : 'Facebook ') + p.format),
      heatmap: postingHeatmap(organic),
      topPosts,
      topReach,
      monthly: monthlyRows,
      gap: longestGapDays(posts, range),
      media: mediaAnalysis(mediaItems, previousMedia),
      hasSocial: posts.length > 0,
      hasMedia: mediaItems.length > 0,
      changes: previousTotals ? {
        posts: pctChange(totals.posts, previousTotals.posts),
        reach: pctChange(totals.reach, previousTotals.reach),
        interactions: pctChange(totals.interactions, previousTotals.interactions),
        engagementPoints: totals.engagementRate - previousTotals.engagementRate,
        mentions: previousMedia && previousMedia.length ? pctChange(mediaItems.length, previousMedia.length) : null,
      } : null,
    };
  }

  // ── Plain-English narrative, summary and recommendations ──────
  function changeWords(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return '';
    if (Math.abs(pct) < 5) return 'roughly flat';
    return (pct > 0 ? 'up ' : 'down ') + Math.abs(Math.round(pct)) + '%';
  }

  function mediaNarrative(stats) {
    const m = stats.media;
    if (!m.total) return '';
    const parts = [];
    parts.push(`Between ${formatDate(m.first)} and ${formatDate(m.last)}, the project was covered ${m.total.toLocaleString('en-US')} time${m.total === 1 ? '' : 's'} across ${m.outletCount} outlet${m.outletCount === 1 ? '' : 's'}.`);
    const lead = m.outlets.slice(0, 3).map(o => `${o.label} (${o.count})`);
    if (lead.length) parts.push(`Coverage was led by ${lead.length > 1 ? lead.slice(0, -1).join(', ') + ' and ' + lead[lead.length - 1] : lead[0]}.`);
    if (m.busiestMonth && m.months.length > 1) {
      const peak = m.moments.slice().sort((a, b) => b.count - a.count)[0];
      parts.push(`The busiest month was ${monthLabel(m.busiestMonth.label)} with ${m.busiestMonth.count} mentions${peak && peak.count > 1 ? `, and the biggest single day was ${formatDate(peak.date)} (${peak.count} stories, including “${peak.items[0].title}”)` : ''}.`);
    }
    if (m.themes.length) parts.push(`The most common theme was ${m.themes[0].label} (${m.themes[0].count} items).`);
    const sentimentTotal = sum(m.sentiments.map(s => s.count));
    if (sentimentTotal) {
      parts.push('Recorded tone: ' + m.sentiments.map(s => `${s.label} ${Math.round((s.count / sentimentTotal) * 100)}%`).join(', ') + '.');
    }
    if (stats.changes && stats.changes.mentions !== null) {
      parts.push(`That is ${changeWords(stats.changes.mentions)} on the previous period (${m.previousTotal} mentions).`);
    }
    if (m.newOutlets.length && m.previousTotal) {
      parts.push(`New outlets this period: ${m.newOutlets.slice(0, 4).join(', ')}${m.newOutlets.length > 4 ? ` and ${m.newOutlets.length - 4} more` : ''}.`);
    }
    return parts.join(' ');
  }

  function bestAndWorst(groups) {
    const reliable = groups.filter(g => g.reliable && g.label !== 'Other');
    if (reliable.length < 2) return { best: reliable[0] || null, worst: null };
    const sorted = reliable.slice().sort((a, b) => b.medianEngagement - a.medianEngagement);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }

  function buildSummary(stats) {
    if (stats.empty) return null;
    const t = stats.totals;
    const c = stats.changes;
    const m = stats.media;
    const formats = bestAndWorst(stats.formats);
    const themes = bestAndWorst(stats.themes);
    const reachLeader = stats.formats.filter(g => g.reliable).sort((a, b) => b.medianReach - a.medianReach)[0];

    // Overview
    const overview = [];
    if (stats.hasSocial) {
      overview.push(`In the ${stats.range.label.toLowerCase()} (${formatDate(stats.range.start)} – ${formatDate(stats.range.end)}), ${t.posts} posts across Instagram and Facebook reached ${formatNumber(t.reach)} accounts and drew ${formatNumber(t.interactions)} interactions, an engagement rate of ${formatPct(t.engagementRate)}.`);
      if (c) {
        overview.push(`Compared with the previous period, reach is ${changeWords(c.reach)}, interactions are ${changeWords(c.interactions)} and the number of posts is ${changeWords(c.posts)}.`);
      }
    } else {
      overview.push('No social posts were recorded in this period.');
    }
    if (stats.hasMedia) {
      overview.push(`Earned media logged ${m.total} mention${m.total === 1 ? '' : 's'} across ${m.outletCount} outlet${m.outletCount === 1 ? '' : 's'}${c && c.mentions !== null ? ` (${changeWords(c.mentions)} on the previous period)` : ''}.`);
    }
    if (stats.boostedCount) {
      overview.push(`${stats.boostedCount} post${stats.boostedCount === 1 ? ' was' : 's were'} most likely boosted (reach more than four times normal), so format and theme comparisons below use organic posts only.`);
    }

    // What's working
    const working = [];
    if (formats.best) working.push(`${formats.best.label} posts earn the strongest engagement (median ${formatPct(formats.best.medianEngagement)} across ${formats.best.posts} posts).`);
    if (reachLeader && (!formats.best || reachLeader.label !== formats.best.label)) working.push(`${reachLeader.label} posts travel furthest, with a median reach of ${formatNumber(reachLeader.medianReach)}.`);
    if (themes.best) working.push(`Of the content themes, ${themes.best.label} resonates most (median engagement ${formatPct(themes.best.medianEngagement)}).`);
    if (stats.topPosts[0]) {
      const top = stats.topPosts[0];
      working.push(`The top post (${formatDate(top.date)}, ${top.platform === 'ig' ? 'Instagram' : 'Facebook'}) reached ${formatNumber(top.reach)} with ${formatPct(top.engagementRate)} engagement: “${top.caption.slice(0, 110)}${top.caption.length > 110 ? '…' : ''}”`);
    }
    if (stats.hasMedia && m.outlets[0]) working.push(`${m.outlets[0].label} is the most consistent media outlet (${m.outlets[0].count} mentions).`);
    if (!working.length) working.push('There is not yet enough data in this period to identify clear strengths.');

    // Needs attention
    const attention = [];
    if (formats.worst && formats.best && formats.worst.medianEngagement < formats.best.medianEngagement * 0.6) {
      attention.push(`${formats.worst.label} posts lag behind (median engagement ${formatPct(formats.worst.medianEngagement)} across ${formats.worst.posts} posts).`);
    }
    if (themes.worst && themes.best && themes.worst.label !== themes.best.label && themes.worst.medianEngagement < themes.best.medianEngagement * 0.7) {
      attention.push(`${themes.worst.label} content earns less engagement than other themes (median ${formatPct(themes.worst.medianEngagement)}).`);
    }
    if (c && c.reach !== null && c.reach <= -10) attention.push(`Reach fell ${Math.abs(Math.round(c.reach))}% on the previous period.`);
    if (c && c.engagementPoints <= -0.5) attention.push(`Engagement rate slipped ${Math.abs(c.engagementPoints).toFixed(1)} points to ${formatPct(t.engagementRate)}.`);
    if (stats.gap && stats.gap.days >= 14) attention.push(`There was a ${Math.round(stats.gap.days)}-day gap with no posts (${formatDate(stats.gap.from)} – ${formatDate(stats.gap.to)}).`);
    if (stats.hasMedia && m.total >= 5 && m.outlets[0] && m.outlets[0].count / m.total > 0.4) {
      attention.push(`Coverage is concentrated: ${Math.round((m.outlets[0].count / m.total) * 100)}% of mentions come from ${m.outlets[0].label}.`);
    }
    const negative = m.sentiments.find(s => /neg/i.test(s.label));
    if (negative && negative.count / Math.max(1, sum(m.sentiments.map(s => s.count))) >= 0.2) {
      attention.push(`${negative.count} media mentions were recorded as negative.`);
    }
    if (c && c.mentions !== null && c.mentions <= -25) attention.push(`Media mentions dropped ${Math.abs(Math.round(c.mentions))}% on the previous period.`);
    if (!attention.length) attention.push('No major warning signs in this period.');

    // Recommendations
    const recs = [];
    if (formats.best) recs.push(`Lean into ${formats.best.label} posts — they consistently earn the most engagement.`);
    if (themes.best) recs.push(`Keep ${themes.best.label} stories at the centre of the content plan${themes.worst && themes.worst.label !== themes.best.label ? `, and rework how ${themes.worst.label} posts are told (stronger visuals, people and outcomes) before cutting them` : ''}.`);
    if (stats.gap && stats.gap.days >= 14) recs.push('Keep a steady posting rhythm — schedule a backlog of evergreen posts so there are no multi-week silences.');
    else if (stats.postsPerWeek < 3 && stats.hasSocial) recs.push(`Posting averaged ${stats.postsPerWeek.toFixed(1)} times a week; aim for at least 3 a week to stay visible.`);
    if (stats.hasMedia) recs.push('Share strong press coverage on social within a day or two of publication, to extend its reach to followers.');
    if (stats.hasMedia && m.total >= 5 && m.outlets[0] && m.outlets[0].count / m.total > 0.4) recs.push(`Broaden media relationships beyond ${m.outlets[0].label} — pitch exclusives or features to outlets that have not covered the project yet.`);
    if (!stats.hasMedia) recs.push('Upload the PR activity workbook so media coverage can be tracked alongside social performance.');
    if (stats.boostedCount) recs.push('Track boosted posts separately so paid reach is not mistaken for organic growth.');

    return {
      overview: overview.join(' '),
      working: working.join(' '),
      attention: attention.join(' '),
      recommendations: recs.slice(0, 5),
    };
  }

  // A compact, factual bundle for the optional AI writer.
  function buildAIEvidence(stats) {
    return {
      period: { label: stats.range.label, start: stats.range.start, end: stats.range.end },
      social: {
        totals: stats.totals,
        previousTotals: stats.previousTotals,
        changes: stats.changes,
        postsPerWeek: Number(stats.postsPerWeek.toFixed(2)),
        likelyBoostedPosts: stats.boostedCount,
        longestGapDays: stats.gap ? stats.gap.days : null,
        formats: stats.formats.map(({ bestPost, ...rest }) => rest),
        themes: stats.themes.map(({ bestPost, ...rest }) => rest),
        topPosts: stats.topPosts.slice(0, 5).map(p => ({ date: p.date, platform: p.platform, format: p.format, reach: p.reach, engagementRate: Number(p.engagementRate.toFixed(2)), theme: p.theme, caption: p.caption.slice(0, 200) })),
      },
      media: {
        total: stats.media.total,
        previousTotal: stats.media.previousTotal,
        outletCount: stats.media.outletCount,
        topOutlets: stats.media.outlets.slice(0, 8),
        newOutlets: stats.media.newOutlets.slice(0, 8),
        types: stats.media.types.slice(0, 6),
        themes: stats.media.themes.slice(0, 6),
        sentiments: stats.media.sentiments,
        months: stats.media.months,
        keyMoments: stats.media.moments.map(mo => ({ date: mo.date, count: mo.count, headlines: mo.items.slice(0, 3).map(i => i.outlet + ': ' + i.title) })),
      },
    };
  }

  const api = {
    num, median, parseDate, formatDate, formatNumber, formatPct, monthLabel,
    normalizeFormat, detectPlatform, parseSocialRows, fromLegacyPost,
    parseMediaRecords, mergePosts, mergeMedia, tagTheme, themeColor, THEMES,
    PERIODS, periodRange, analyze, mediaNarrative, buildSummary, buildAIEvidence,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC = api;
})(typeof window !== 'undefined' ? window : globalThis);
