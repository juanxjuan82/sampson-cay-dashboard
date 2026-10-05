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
      // Facebook rows marked "Is crosspost" are kept: their reach and engagement are
      // Facebook-only, separate from the Instagram copy of the same video.
      if (!id || !date) {
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

  // Meta's CSV exports give publish times in US Pacific time. The Bahamas runs on
  // US Eastern time (same daylight-saving dates), so it is always 3 hours later.
  const EXPORT_TO_BAHAMAS_HOURS = 3;

  function bahamasDayAndHour(post) {
    const shifted = post.hour + EXPORT_TO_BAHAMAS_HOURS;
    const dayShift = Math.floor(shifted / 24);
    return {
      day: (new Date(post.date + 'T00:00:00Z').getUTCDay() + dayShift) % 7,
      hour: shifted % 24,
    };
  }

  // Median engagement for each weekday × time-of-day block, in Bahamas time.
  function postingHeatmap(posts) {
    const cells = TIME_BLOCKS.map(() => WEEKDAYS.map(() => []));
    posts.forEach(post => {
      if (!Number.isInteger(post.hour) || post.reach <= 0) return;
      const { day, hour } = bahamasDayAndHour(post);
      const block = TIME_BLOCKS.findIndex(b => hour >= b.from && hour <= b.to);
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
  // Meta's exports don't say which posts were paid, so it is inferred from reach.
  // On this account organic posts almost never pass ~1,500 reach while boosted ones
  // reach 2,000–50,000, so anything at or above BOOSTED_REACH counts as boosted.
  // The "4× the usual" rule still catches outliers if the account's scale changes.
  const BOOSTED_REACH = 2000;
  // A format or theme needs at least this many organic posts before it is compared.
  const MIN_POSTS_TO_COMPARE = 5;

  function markBoosted(posts) {
    const medians = {};
    ['ig', 'fb'].forEach(platform => {
      medians[platform] = median(posts.filter(p => p.platform === platform && p.reach > 0 && p.reach < BOOSTED_REACH).map(p => p.reach));
    });
    return posts.map(p => ({
      ...p,
      boosted: p.reach >= BOOSTED_REACH || (medians[p.platform] > 0 && p.reach > medians[p.platform] * 4 && p.reach > 500),
    }));
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

  function organicStats(posts) {
    const stat = items => ({
      posts: items.length,
      medianReach: median(items.map(p => p.reach)),
      medianEngagement: median(items.filter(p => p.reach > 0).map(p => (p.interactions / p.reach) * 100)),
      engagementRate: engagementRate(items),
    });
    return {
      all: stat(posts),
      ig: stat(posts.filter(p => p.platform === 'ig')),
      fb: stat(posts.filter(p => p.platform === 'fb')),
    };
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
      latestAll: items.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25),
      first: items.length ? items.reduce((min, item) => item.date < min ? item.date : min, items[0].date) : null,
      last: items.length ? items.reduce((max, item) => item.date > max ? item.date : max, items[0].date) : null,
    };
  }

  // ── Kinds of content (what a post is doing, read from its caption) ──
  // A post can belong to more than one kind. Used to say what the audience responds to.
  const CONTENT_KINDS = [
    { id: 'progress', label: 'progress updates', re: /\b(roof|construction|community cent(er|re)|site prep\w*|preparatory work|surveys?|soundscape|progress is rising|groundbreaking|broke ground|break(s|ing)? ground|crews|taking shape)\b/i },
    { id: 'news', label: 'responses to the news', re: /\b(turtlegrass|survey|unfounded|set(ting)? the record|questionable|rhetoric|bullying|gatekeeping|court|judicial|as reported|accusation|the facts|ruling|hearing|proceedings)\b/i },
    { id: 'voices', label: 'community voices', re: /“[^”]{15,}”|"[^"]{15,}"|\b(residents?|business owners?|locals?) (say|share|told|are clear|speak)|hear directly|in their own words|community told us/i },
    { id: 'commitments', label: 'environmental commitment posts', re: /\b(leed|sustainab\w*|environmental (stewardship|standards|protection|practices|process)|protect(ing)? (the )?(environment|beauty|what makes)|conservation|preserv\w*|xco₂?)\b/i },
    { id: 'giving', label: 'giving-back posts', re: /\b(donat\w*|gifts?|christmas|school supplies|bicycles?|printer|clinic|condolences|sponsor\w*)\b/i },
  ];

  function contentKindStats(organicPosts) {
    const ig = organicPosts.filter(p => p.platform === 'ig' && p.reach > 0);
    const rate = p => (p.interactions / p.reach) * 100;
    const sharesPer = items => items.length ? sum(items.map(p => p.shares || 0)) / items.length : 0;
    return CONTENT_KINDS.map(kind => {
      const inKind = organicPosts.filter(p => kind.re.test(p.caption || ''));
      const rest = organicPosts.filter(p => !kind.re.test(p.caption || ''));
      const igIn = ig.filter(p => kind.re.test(p.caption || ''));
      const igRest = ig.filter(p => !kind.re.test(p.caption || ''));
      return {
        id: kind.id,
        label: kind.label,
        posts: inKind.length,
        igPosts: igIn.length,
        igEngagement: igIn.length ? median(igIn.map(rate)) : null,
        igEngagementRest: igRest.length ? median(igRest.map(rate)) : null,
        sharesPerPost: sharesPer(inKind),
        sharesPerPostRest: sharesPer(rest),
      };
    });
  }

  function kindOf(post) {
    const kind = CONTENT_KINDS.find(k => k.re.test(post.caption || ''));
    return kind ? kind.id : null;
  }

  // Coverage led by the project's opponents (Turtlegrass, Save the Bays / Save Exuma Alliance, their claims).
  const OPPOSITION_RE = /turtlegrass|turtle grass|\bTG\b|save (the )?bays?|save exuma|\bSEA\b|opponent|salami|halt(ed)?\b|plans don.?t add up|sound the alarm/i;

  function isOppositionLed(item) {
    return OPPOSITION_RE.test(item.title + ' ' + item.theme);
  }

  // The longest stretch without posts, and how much coverage ran during it.
  function quietDuringNews(gap, mediaItems) {
    if (!gap || gap.days < 10) return null;
    const during = mediaItems.filter(m => m.date > gap.from && m.date < gap.to);
    return during.length >= 3 ? { ...gap, stories: during.length, oppositionStories: during.filter(isOppositionLed).length } : null;
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
    const paidPosts = posts.filter(p => p.boosted);
    const paid = {
      posts: paidPosts.length,
      reach: sum(paidPosts.map(p => p.reach)),
      reachShare: totals.reach > 0 ? sum(paidPosts.map(p => p.reach)) / totals.reach : 0,
      engagementRate: engagementRate(paidPosts),
    };
    const organicByPlatform = organicStats(organic);
    const previousOrganic = previousPosts && previousPosts.length ? organicStats(previousPosts.filter(p => !p.boosted)) : null;
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
      formats: groupStats(organic, p => (p.platform === 'ig' ? 'Instagram ' : 'Facebook ') + p.format, MIN_POSTS_TO_COMPARE),
      themes: groupStats(organic, p => p.theme, MIN_POSTS_TO_COMPARE),
      themeCounts: countBy(posts, p => p.theme),
      contentMix: countBy(posts, p => (p.platform === 'ig' ? 'Instagram ' : 'Facebook ') + p.format),
      heatmap: postingHeatmap(organic),
      topPosts,
      topReach,
      monthly: monthlyRows,
      gap: longestGapDays(posts, range),
      quietDuringNews: quietDuringNews(longestGapDays(posts, range), mediaItems),
      contentKinds: contentKindStats(organic),
      organicPostCount: organic.length,
      // Comments are turned off on the project's posts, so a lack of comments says nothing about the audience.
      commentsOff: Boolean(data.settings && data.settings.commentsOff),
      topPostKind: topPosts[0] ? kindOf(topPosts[0]) : null,
      media: Object.assign(mediaAnalysis(mediaItems, previousMedia), {
        oppositionLed: mediaItems.filter(isOppositionLed).length,
      }),
      hasSocial: posts.length > 0,
      hasMedia: mediaItems.length > 0,
      paid,
      response: {
        organic: { comments: sum(organic.map(p => p.comments || 0)), shares: sum(organic.map(p => p.shares || 0)), saves: sum(organic.map(p => p.saves || 0)), instagramFollows: sum(organic.map(p => p.follows || 0)) },
        boosted: { comments: sum(paidPosts.map(p => p.comments || 0)), shares: sum(paidPosts.map(p => p.shares || 0)), saves: sum(paidPosts.map(p => p.saves || 0)), instagramFollows: sum(paidPosts.map(p => p.follows || 0)) },
      },
      organic: organicByPlatform,
      previousOrganic,
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
    let best = sorted[0];
    // Two groups within 10% of each other are effectively tied, so name both.
    if (sorted.length > 2 && sorted[1].medianEngagement >= best.medianEngagement * 0.9) {
      const [first, second] = [best.label, sorted[1].label];
      const sharedPrefix = first.split(' ')[0] === second.split(' ')[0] && first.includes(' ') ? first.split(' ')[0] + ' ' : '';
      best = Object.assign({}, best, {
        label: sharedPrefix ? `${first} and ${second.slice(sharedPrefix.length)}` : `${first} and ${second}`,
        posts: best.posts + sorted[1].posts,
        medianEngagement: (best.medianEngagement + sorted[1].medianEngagement) / 2,
      });
    }
    return { best, worst: sorted[sorted.length - 1] };
  }

  // Writes the period summary. Tone: interpretive and forward-looking. We published this
  // content, so findings are framed as what we learn and where to focus next — never as
  // what should have been done differently.
  const MIN_POSTS_FOR_SUMMARY = 8;

  function buildSummary(stats) {
    if (stats.empty) return null;
    const t = stats.totals;
    const m = stats.media;
    const paid = stats.paid;
    const org = stats.organic;
    const prevOrg = stats.previousOrganic;
    const resp = stats.response;
    const kinds = Object.fromEntries((stats.contentKinds || []).map(k => [k.id, k]));
    const enough = stats.organicPostCount >= MIN_POSTS_FOR_SUMMARY;
    const periodName = stats.range.id === 'all' ? 'the full history so far' : `the ${stats.range.label.toLowerCase()}`;
    const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

    // A kind of content "resonates" when its typical Instagram engagement is clearly above the rest,
    // or when it is shared clearly more often. Needs a few posts on each side to say so.
    const resonates = k => k && k.igPosts >= 3 && k.igEngagementRest !== null && k.igEngagement >= k.igEngagementRest * 1.15;
    const shared = k => k && k.posts >= 3 && k.sharesPerPost >= 1 && k.sharesPerPost >= k.sharesPerPostRest * 1.5;
    const lags = k => k && k.igPosts >= 3 && k.igEngagementRest !== null && k.igEngagement <= k.igEngagementRest * 0.9;

    // ── Overview ──
    const overview = [];
    if (!stats.hasSocial) {
      overview.push(`No social posts were published in ${periodName}.`);
    } else {
      const followsPaid = resp.boosted.instagramFollows;
      const followsAll = followsPaid + resp.organic.instagramFollows;
      if (paid.posts && paid.reachShare >= 0.5) {
        overview.push(`In ${periodName}, the channels worked mainly as a paid broadcast: boosted posts brought ${Math.round(paid.reachShare * 100)}% of the ${formatNumber(t.reach)} accounts reached${followsAll >= 20 && followsPaid / followsAll >= 0.7 ? `, and most new Instagram followers (${followsPaid} of ${followsAll})` : ''}.`);
      } else if (paid.posts) {
        overview.push(`${periodName.replace(/^t/, 'T')} was mostly organic (${plural(paid.posts, 'boosted post')}), so it shows the channels' natural reach.`);
      } else {
        overview.push(`Nothing was boosted in ${periodName}, so these results show the channels' natural reach.`);
      }
      if (org.all.posts) {
        overview.push(`${paid.posts ? 'Without boosting, a post' : 'A post'} typically reaches a core audience of about ${formatNumber(org.all.medianReach)} people${org.ig.posts >= 3 ? `, and on Instagram that core is engaged (${formatPct(org.ig.medianEngagement)} typical engagement${prevOrg && prevOrg.ig.posts >= 3 && org.ig.medianEngagement - prevOrg.ig.medianEngagement >= 1 ? ', and rising' : ''})` : ''}.`);
      }
      if (stats.organicPostCount >= 5 && stats.commentsOff) {
        overview.push(`With comments turned off, shares and saves are the clearest signs of support: ${plural(stats.organicPostCount, 'unboosted post')} drew ${plural(resp.organic.shares, 'share')} and ${plural(resp.organic.saves, 'save')}.`);
      } else if (stats.organicPostCount >= 5 && resp.organic.comments / stats.organicPostCount < 0.5) {
        overview.push(`That audience responds mostly with likes: ${plural(resp.organic.comments, 'comment')} and ${plural(resp.organic.shares, 'share')} across ${plural(stats.organicPostCount, 'unboosted post')}, so the visible conversation on our channels is still small.`);
      }
    }
    if (stats.hasMedia) {
      const oppShare = m.total ? m.oppositionLed / m.total : 0;
      overview.push(`Earned media recorded ${plural(m.total, 'mention')} across ${plural(m.outletCount, 'outlet')}${oppShare >= 0.25 ? `, and about ${Math.round(oppShare * 100)}% of it appears to have been driven by opponents' claims, so the project's perspective is competing for attention` : ''}.`);
    }

    // ── What's resonating ──
    const working = [];
    if (!enough) {
      working.push(`There are too few unboosted posts in ${periodName} (${stats.organicPostCount}) to say reliably what resonates; the 12-month view is a better guide.`);
    } else {
      if (resonates(kinds.progress)) working.push(`Seeing the project take shape lands best: progress updates drew ${formatPct(kinds.progress.igEngagement)} typical engagement on Instagram, against ${formatPct(kinds.progress.igEngagementRest)} for other posts. Visible proof is the most persuasive thing we can show.`);
      if (shared(kinds.news)) working.push(`When we respond to the news, supporters pass it on: these posts were shared ${kinds.news.sharesPerPost.toFixed(1)} times each, against ${kinds.news.sharesPerPostRest.toFixed(1)} for other posts. The core audience is ready to carry the project's side of the story.`);
      else if (resonates(kinds.news)) working.push(`Responses to the news drew above-average engagement (${formatPct(kinds.news.igEngagement)} on Instagram), a sign the audience wants to hear the project's side.`);
      if (resonates(kinds.voices)) working.push(`Posts where residents and business owners speak drew ${formatPct(kinds.voices.igEngagement)} engagement, against ${formatPct(kinds.voices.igEngagementRest)} for the rest: third-party voices carry weight.`);
      if (resonates(kinds.giving)) working.push(`Giving-back posts connected well (${formatPct(kinds.giving.igEngagement)} engagement on Instagram).`);
      if (resonates(kinds.commitments)) working.push(`Environmental posts resonated this period (${formatPct(kinds.commitments.igEngagement)} engagement on Instagram), which is worth building on given how central the environment is to the public debate.`);
      if (org.ig.posts >= 3 && org.fb.posts >= 3 && org.ig.medianEngagement >= org.fb.medianEngagement * 2) {
        working.push(`Instagram is where the relationship lives: typical engagement of ${formatPct(org.ig.medianEngagement)} there, against ${formatPct(org.fb.medianEngagement)} on Facebook.`);
      }
      if (stats.topPosts[0]) {
        const top = stats.topPosts[0];
        const kind = CONTENT_KINDS.find(k => k.id === stats.topPostKind);
        working.push(`The standout post (${formatDate(top.date)}) was “${top.caption.slice(0, 70).trim()}${top.caption.length > 70 ? '…' : ''}”${kind ? `, one of the ${kind.label}` : ''}.`);
      }
    }
    if (stats.hasMedia && m.outlets[0] && m.total >= 5) {
      working.push(`${m.outlets.slice(0, 2).map(o => o.label).join(' and ')} covered the project most often, which makes them dependable outlets for the project's perspective.`);
    }
    if (!working.length) working.push(`No clear standouts in ${periodName}.`);

    // ── What to focus on next ──
    // Each point has a priority; credibility points rank high given the competing narrative.
    const focus = [];
    const add = (priority, text) => focus.push([priority, text]);
    if (org.all.posts >= 5 && org.all.medianReach < 500) {
      add(1, `Growing the organic audience is the biggest opportunity: an unboosted post typically reaches about ${formatNumber(org.all.medianReach)} people. Co-posting with partners and featuring community members by name can carry posts to their followers too.`);
    }
    if (paid.posts >= 3 && org.all.posts >= 3 && paid.engagementRate < org.all.medianEngagement / 2) {
      add(4, `Boosted posts brought wide attention but little interaction (${formatPct(paid.engagementRate)} engagement). The takeaway is to put paid reach behind posts that have already earned a response from the core audience.`);
    }
    if (enough && lags(kinds.commitments)) {
      add(5, `Environmental commitment posts drew less response than the rest of the feed (${formatPct(kinds.commitments.igEngagement)} against ${formatPct(kinds.commitments.igEngagementRest)} on Instagram). With environmental approvals at the centre of the public debate, evidence, data and independent experts are the opportunity here.`);
    }
    if (stats.hasSocial && stats.organicPostCount >= 5 && stats.commentsOff) {
      add(6, 'With comments off, shares are how supporters speak up. Designing posts to be passed on, with one clear fact or a quote worth repeating, will carry the project\'s story further.');
    } else if (stats.hasSocial && stats.organicPostCount >= 5 && resp.organic.comments / stats.organicPostCount < 0.5) {
      add(6, 'Building visible two-way conversation is a natural next step: inviting questions and replying publicly will make the support that exists easier to see.');
    }
    if (stats.quietDuringNews) {
      const q = stats.quietDuringNews;
      add(3, `The ${Math.round(q.days)}-day pause in posting (${formatDate(q.from)} – ${formatDate(q.to)}) overlapped with ${plural(q.stories, 'media story', )}${q.oppositionStories ? `, ${q.oppositionStories} of them driven by opponents` : ''}. Keeping a steady presence during busy news weeks will keep the project's voice in the conversation.`.replace('media storys', 'media stories'));
    } else if (stats.gap && stats.gap.days >= 14) {
      add(3, `Posting paused for ${Math.round(stats.gap.days)} days (${formatDate(stats.gap.from)} – ${formatDate(stats.gap.to)}); a small backlog of ready-to-go posts will keep the rhythm steady.`);
    }
    if (stats.hasMedia && m.total >= 5 && m.oppositionLed / m.total >= 0.25) {
      add(2, 'Much of the coverage carried opponents\' framing. Quick, factual responses and sharing supportive coverage within a day or two will help keep the project\'s perspective in front of audiences.');
    }
    if (stats.hasMedia && m.total >= 5 && m.outlets[0] && m.outlets[0].count / m.total > 0.4) {
      add(7, `${Math.round((m.outlets[0].count / m.total) * 100)}% of coverage came from ${m.outlets[0].label}; widening relationships with other outlets will broaden who hears the project's story.`);
    }
    if (!focus.length) add(9, 'Keep doing what is working; nothing in this period calls for a change of direction.');
    // Keep the four most important points.
    const focusText = focus.sort((a, b) => a[0] - b[0]).slice(0, 4).map(f => f[1]);

    return {
      overview: overview.join(' '),
      working: working.join(' '),
      attention: focusText.join(' '),
      recommendations: buildRecommendations(stats, kinds),
    };
  }

  // Default strategic recommendations, used until an analyst saves their own.
  function buildRecommendations(stats, kinds) {
    const recs = [];
    const org = stats.organic;
    const commitmentsLag = kinds.commitments && kinds.commitments.igPosts >= 3 && kinds.commitments.igEngagementRest !== null && kinds.commitments.igEngagement <= kinds.commitments.igEngagementRest * 0.9;
    recs.push(`Lead with proof: show visible progress, evidence and independent experts${commitmentsLag ? ', rather than statements of commitment' : ''}.`);
    recs.push('Let the community speak for the project: named residents and business owners in their own words, through co-posts and short videos.');
    if (stats.hasMedia) recs.push('Respond quickly when news breaks: a short factual post the same day, then share supportive coverage within 24–48 hours.');
    if (stats.paid.posts) recs.push('Use paid reach deliberately: boost posts that have already earned a response organically.');
    if (org.ig.posts >= 3 && org.fb.posts >= 3 && org.ig.medianEngagement >= org.fb.medianEngagement * 2) recs.push('Make Instagram the home for community conversation, and use Facebook mainly for wider distribution.');
    return recs.slice(0, 5);
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
        audienceResponse: stats.response,
        commentsTurnedOff: stats.commentsOff,
        topPostsCaptionsNote: 'Captions show what each top post was about; use them to judge which kinds of content (proof of progress, community voices, news responses, commitments) earn a response.',
        boosted: stats.paid,
        organicByPlatform: stats.organic,
        previousOrganicByPlatform: stats.previousOrganic,
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
        recentHeadlines: stats.media.latestAll.map(i => ({ date: i.date, outlet: i.outlet, type: i.type, theme: i.theme, title: i.title.slice(0, 160) })),
        keyMoments: stats.media.moments.map(mo => ({ date: mo.date, count: mo.count, headlines: mo.items.slice(0, 3).map(i => i.outlet + ': ' + i.title) })),
      },
    };
  }

  const api = {
    num, median, parseDate, formatDate, formatNumber, formatPct, monthLabel,
    normalizeFormat, detectPlatform, parseSocialRows, fromLegacyPost,
    parseMediaRecords, mergePosts, mergeMedia, tagTheme, themeColor, THEMES, bahamasDayAndHour, postingHeatmap,
    PERIODS, periodRange, analyze, mediaNarrative, buildSummary, buildAIEvidence, isOppositionLed, CONTENT_KINDS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC = api;
})(typeof window !== 'undefined' ? window : globalThis);
