// Sampson Cay dashboard — page behaviour.
// index.html runs this in "admin" mode (upload, save, edit); report.html runs it in "client" mode (read-only).
(function () {
  'use strict';

  const MODE = document.body.dataset.mode === 'client' ? 'client' : 'admin';
  const DATA_URL = 'data/dashboard.json';
  const DATA_PATH = 'data/dashboard.json';
  const LOCAL_KEY = 'sampson_dashboard_local_v1';
  const DEFAULT_REPO = 'juanxjuan82/sampson-cay-dashboard';
  const COLORS = { ig: '#d6336c', fb: '#1877f2', media: '#0d5a6c' };

  let data = emptyData();
  let unsaved = false;
  let period = '90';
  let stats = null;
  let editing = false;
  let showAllMedia = false;
  let mediaSearch = '';
  const charts = {};

  function emptyData() {
    return { version: 1, savedAt: null, updatedAt: null, posts: [], media: [], summary: null };
  }

  // ── Storage helpers (browser storage can be blocked, so never let it crash the page) ──
  function readStore(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '';
  }
  const $ = id => document.getElementById(id);

  // ── Loading ────────────────────────────────────────────────────
  async function loadRemote() {
    try {
      const response = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      return null;
    }
  }

  function normalize(raw) {
    const d = Object.assign(emptyData(), raw || {});
    d.posts = Array.isArray(d.posts) ? d.posts : [];
    d.media = Array.isArray(d.media) ? d.media : [];
    return d;
  }

  async function init() {
    period = readStore('sampson_dashboard_period', '90') || '90';
    if (!SC.PERIODS[period]) period = '90';
    const remote = await loadRemote();
    const local = MODE === 'admin' ? readStore(LOCAL_KEY, null) : null;
    // Use this browser's copy only when it has changes newer than the published file.
    if (local && local.updatedAt && (!remote || !remote.savedAt || local.updatedAt > remote.savedAt)) {
      data = normalize(local);
      unsaved = Boolean(remote) || data.posts.length > 0 || data.media.length > 0;
    } else {
      data = normalize(remote);
      unsaved = false;
    }
    // The client report opens on the period the saved summary was written for.
    if (MODE === 'client' && data.summary && SC.PERIODS[String(data.summary.key || '').split('|')[0]]) {
      period = data.summary.key.split('|')[0];
    }
    renderShell();
    render();
  }

  function markChanged() {
    data.updatedAt = new Date().toISOString();
    unsaved = true;
    if (!writeStore(LOCAL_KEY, data)) {
      setSaveStatus('This browser could not keep a copy. Click “Save to website” so the data is not lost.', 'warn');
    }
    render();
  }

  // ── Page skeleton ──────────────────────────────────────────────
  function renderShell() {
    const admin = MODE === 'admin';
    $('app').innerHTML = `
      ${admin ? `
      <section class="card admin-only" id="data-panel">
        <div class="section-head">
          <div><h2>Data</h2><p class="muted" style="margin:0">New uploads are added to the saved history. Re-uploading the same posts or articles updates them, it never duplicates them.</p></div>
        </div>
        <div class="upload-grid">
          <label class="upload-tile"><input type="file" id="in-social" accept=".csv" multiple>
            <strong>📊 Facebook / Instagram CSVs</strong><span>Meta Business Suite post exports. Select one or several.</span></label>
          <label class="upload-tile"><input type="file" id="in-media" accept=".xlsx,.xls,.csv">
            <strong>📰 PR activity workbook</strong><span>.xlsx with a “Media Mentions” sheet, or a .csv export of it.</span></label>
          <div class="upload-tile" style="cursor:default">
            <strong id="data-counts">—</strong><span id="data-range"></span>
            <div class="btn-row" style="justify-content:center;margin-top:8px">
              <button class="btn btn-link" id="btn-clear-media" type="button">Clear media history</button>
              <button class="btn btn-link" id="btn-clear-social" type="button">Clear social history</button>
            </div>
          </div>
        </div>
        <ul class="log" id="upload-log"></ul>
        <div class="save-bar">
          <span class="status" id="save-status"></span>
          <div class="btn-row">
            <button class="btn" id="btn-settings" type="button">⚙ Settings</button>
            <a class="btn" href="report.html" target="_blank" rel="noopener">View client report ↗</a>
            <button class="btn btn-primary" id="btn-save" type="button">⬆ Save to website</button>
          </div>
        </div>
      </section>` : ''}
      <div class="section-head" style="margin-top:${admin ? '24px' : '0'}">
        <div class="pills no-print" id="period-pills" role="group" aria-label="Time period">
          ${Object.entries(SC.PERIODS).map(([id, p]) => `<button type="button" data-period="${id}">${p.label}</button>`).join('')}
        </div>
        <button class="btn no-print" type="button" onclick="window.print()">🖨 Print / PDF</button>
      </div>
      <div id="content"></div>
      ${admin ? settingsModalHTML() : ''}
    `;

    $('period-pills').addEventListener('click', event => {
      const button = event.target.closest('button[data-period]');
      if (!button) return;
      period = button.dataset.period;
      writeStore('sampson_dashboard_period', period);
      editing = false;
      render();
    });

    if (admin) {
      $('in-social').addEventListener('change', event => handleSocialFiles(event.target));
      $('in-media').addEventListener('change', event => handleMediaFile(event.target));
      $('btn-save').addEventListener('click', saveToWebsite);
      $('btn-settings').addEventListener('click', openSettings);
      $('btn-clear-media').addEventListener('click', () => {
        if (!data.media.length || !confirm(`Remove all ${data.media.length} media mentions from the history? (Nothing changes on the website until you click Save.)`)) return;
        data.media = [];
        logUpload('Media history cleared.');
        markChanged();
      });
      $('btn-clear-social').addEventListener('click', () => {
        if (!data.posts.length || !confirm(`Remove all ${data.posts.length} social posts from the history? (Nothing changes on the website until you click Save.)`)) return;
        data.posts = [];
        logUpload('Social history cleared.');
        markChanged();
      });
      document.querySelectorAll('.upload-tile input').forEach(input => {
        const tile = input.closest('.upload-tile');
        input.addEventListener('dragenter', () => tile.classList.add('dragover'));
        input.addEventListener('dragleave', () => tile.classList.remove('dragover'));
        input.addEventListener('drop', () => tile.classList.remove('dragover'));
      });
      $('settings-close').addEventListener('click', closeSettings);
      $('settings-save').addEventListener('click', saveSettings);
    }
  }

  // ── Uploads ────────────────────────────────────────────────────
  function logUpload(message, type) {
    const log = $('upload-log');
    if (!log) return;
    const li = document.createElement('li');
    li.className = 'status ' + (type || '');
    li.textContent = message;
    log.prepend(li);
    while (log.children.length > 6) log.lastChild.remove();
  }

  async function handleSocialFiles(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const result = SC.parseSocialRows(parsed.data, parsed.meta.fields || []);
        if (!result.platform) {
          logUpload(`${file.name}: not recognised as a Facebook or Instagram post export.`, 'err');
          continue;
        }
        if (!result.posts.length) {
          logUpload(`${file.name}: no posts found.`, 'err');
          continue;
        }
        const merged = SC.mergePosts(data.posts, result.posts);
        data.posts = merged.posts;
        const name = result.platform === 'ig' ? 'Instagram' : 'Facebook';
        logUpload(`${file.name} (${name}): ${result.posts.length} posts — ${merged.added} new, ${merged.updated} updated${result.skipped ? `, ${result.skipped} rows skipped` : ''}.`, 'ok');
        markChanged();
      } catch (error) {
        logUpload(`${file.name}: could not be read (${error.message}).`, 'err');
      }
    }
  }

  async function readMediaRecords(file) {
    if (/\.csv$/i.test(file.name)) {
      return Papa.parse(await file.text(), { header: true, skipEmptyLines: true }).data;
    }
    if (!window.XLSX) throw new Error('the Excel reader did not load — refresh the page');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheetName = workbook.SheetNames.find(name => name.trim().toLowerCase() === 'media mentions') || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    // Titles are often hyperlinks: pull the link out of the cell itself.
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] || [];
    const titleColumn = headers.findIndex(h => /^(article title( & url)?|title|headline)$/i.test(String(h).trim()));
    if (titleColumn >= 0) {
      records.forEach(record => {
        if (!Number.isInteger(record.__rowNum__)) return;
        const cell = sheet[XLSX.utils.encode_cell({ r: record.__rowNum__, c: titleColumn })];
        if (cell && cell.l && /^https?:\/\//i.test(cell.l.Target || '') && !record['Article URL']) record['Article URL'] = cell.l.Target;
      });
    }
    return records;
  }

  async function handleMediaFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const result = SC.parseMediaRecords(await readMediaRecords(file));
      if (!result.items.length) {
        logUpload(`${file.name}: no media mentions found. Each row needs a publication name, a title and a publish date.`, 'err');
        return;
      }
      const merged = SC.mergeMedia(data.media, result.items);
      data.media = merged.media;
      logUpload(`${file.name}: ${result.items.length} mentions — ${merged.added} new${result.skipped ? `, ${result.skipped} incomplete rows skipped` : ''}.`, 'ok');
      markChanged();
    } catch (error) {
      logUpload(`${file.name}: could not be read (${error.message}).`, 'err');
    }
  }

  // ── Save to website (writes data/dashboard.json to GitHub) ─────
  function ghSettings() {
    const saved = readStore('gh_settings', {}) || {};
    return { token: saved.token || '', repo: saved.repo || DEFAULT_REPO };
  }

  function setSaveStatus(message, type) {
    const el = $('save-status');
    if (!el) return;
    el.className = 'status ' + (type || '');
    el.textContent = message;
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function saveToWebsite() {
    const { token, repo } = ghSettings();
    if (!token) {
      openSettings();
      setSaveStatus('Add your GitHub token in Settings first.', 'warn');
      return;
    }
    const button = $('btn-save');
    button.disabled = true;
    setSaveStatus('Saving…');
    const api = `https://api.github.com/repos/${repo}/contents/${DATA_PATH}`;
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const toSave = Object.assign({}, data, { savedAt: new Date().toISOString() });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await fetch(api + '?t=' + Date.now(), { headers, cache: 'no-store' });
        if (current.status === 401 || current.status === 403) throw new Error('GitHub rejected the token. Check it in Settings.');
        const sha = current.ok ? (await current.json()).sha : undefined;
        const response = await fetch(api, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify({
            message: `Update dashboard data — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            content: toBase64(JSON.stringify(toSave)),
            sha,
          }),
        });
        if (response.ok) {
          data = toSave;
          data.updatedAt = data.savedAt;
          unsaved = false;
          writeStore(LOCAL_KEY, data);
          setSaveStatus('✓ Saved. The live site and client report update in about a minute.', 'ok');
          renderDataPanel();
          return;
        }
        if (response.status !== 409 && response.status !== 422) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.message || `GitHub returned ${response.status}`);
        }
      }
      throw new Error('the file changed on GitHub while saving — try again');
    } catch (error) {
      setSaveStatus('Save failed: ' + error.message, 'err');
    } finally {
      button.disabled = false;
    }
  }

  // ── Settings (GitHub token + optional AI writer) ───────────────
  function settingsModalHTML() {
    return `
      <div class="modal-back" id="settings" hidden>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <h2 id="settings-title">Settings</h2>
          <p class="hint">These stay in this browser only.</p>
          <label for="set-token">GitHub token</label>
          <input id="set-token" type="password" autocomplete="off" placeholder="github_pat_…">
          <p class="hint">Needed for “Save to website”. A fine-grained token with <b>Contents: read and write</b> on the dashboard repository.</p>
          <label for="set-repo">Repository</label>
          <input id="set-repo" type="text" placeholder="${DEFAULT_REPO}">
          <label for="set-ai-url">AI writer URL (optional)</label>
          <input id="set-ai-url" type="url" placeholder="https://….workers.dev">
          <label for="set-ai-token">AI writer access token (optional)</label>
          <input id="set-ai-token" type="password" autocomplete="off">
          <label for="set-ai-context">Background for the AI writer (optional)</label>
          <textarea id="set-ai-context" placeholder="Goals, audiences, campaigns, anything the numbers don't show."></textarea>
          <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
            <button class="btn" id="settings-close" type="button">Cancel</button>
            <button class="btn btn-primary" id="settings-save" type="button">Save settings</button>
          </div>
        </div>
      </div>`;
  }

  function openSettings() {
    const gh = ghSettings();
    $('set-token').value = gh.token;
    $('set-repo').value = gh.repo;
    $('set-ai-url').value = readStore('dashboard_ai_endpoint_v2', '') || legacyAIEndpoint();
    $('set-ai-token').value = readStore('dashboard_ai_token_v2', '') || '';
    $('set-ai-context').value = readStore('dashboard_ai_context_v2', '') || legacyAIContext();
    $('settings').hidden = false;
  }
  function legacyAIEndpoint() {
    try { return localStorage.getItem('dashboard_ai_endpoint') || ''; } catch (e) { return ''; }
  }
  function legacyAIContext() {
    try { return localStorage.getItem('dashboard_ai_context') || ''; } catch (e) { return ''; }
  }
  function closeSettings() { $('settings').hidden = true; }
  function saveSettings() {
    writeStore('gh_settings', { token: $('set-token').value.trim(), repo: $('set-repo').value.trim() || DEFAULT_REPO });
    writeStore('dashboard_ai_endpoint_v2', $('set-ai-url').value.trim().replace(/\/+$/, ''));
    writeStore('dashboard_ai_token_v2', $('set-ai-token').value.trim());
    writeStore('dashboard_ai_context_v2', $('set-ai-context').value.trim());
    closeSettings();
    setSaveStatus('Settings saved.', 'ok');
    render();
  }

  // ── Rendering ──────────────────────────────────────────────────
  function render() {
    document.querySelectorAll('#period-pills button').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    renderDataPanel();
    stats = SC.analyze(data, period);
    const content = $('content');
    Object.keys(charts).forEach(key => { charts[key].destroy(); delete charts[key]; });

    if (stats.empty) {
      $('header-period').textContent = 'No data yet';
      content.innerHTML = `<div class="card empty">${MODE === 'admin'
        ? 'Upload your Facebook / Instagram CSVs and PR activity workbook above to build the dashboard.'
        : 'This report has no data yet.'}</div>`;
      return;
    }
    $('header-period').textContent = `${stats.range.label} · ${SC.formatDate(stats.range.start)} – ${SC.formatDate(stats.range.end)}`;
    content.innerHTML = kpiHTML() + summaryHTML() + socialHTML() + mediaHTML();
    bindSummary();
    bindMedia();
    drawCharts();
  }

  function renderDataPanel() {
    if (MODE !== 'admin' || !$('data-counts')) return;
    const ig = data.posts.filter(p => p.platform === 'ig').length;
    const fb = data.posts.filter(p => p.platform === 'fb').length;
    $('data-counts').textContent = `${ig} Instagram · ${fb} Facebook posts · ${data.media.length} media mentions`;
    const dates = [...data.posts.map(p => p.date), ...data.media.map(m => m.date)].sort();
    $('data-range').textContent = dates.length ? `Saved history: ${SC.formatDate(dates[0])} – ${SC.formatDate(dates[dates.length - 1])}` : 'Nothing saved yet';
    if (unsaved) setSaveStatus('● Unsaved changes — click “Save to website” so the client report and other computers get them.', 'warn');
    else if (data.savedAt && !$('save-status').textContent) setSaveStatus(`Last saved ${new Date(data.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`);
  }

  function changeHTML(pct, suffix) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return '<div class="change">&nbsp;</div>';
    const rounded = Math.round(pct);
    const cls = rounded > 0 ? 'up' : rounded < 0 ? 'down' : '';
    return `<div class="change ${cls}">${rounded > 0 ? '▲' : rounded < 0 ? '▼' : '•'} ${Math.abs(rounded)}${suffix || '%'} vs previous</div>`;
  }

  function pointsChangeHTML(points) {
    if (points === null || points === undefined || !Number.isFinite(points)) return '<div class="change">&nbsp;</div>';
    const rounded = Math.round(points * 10) / 10;
    const cls = rounded > 0 ? 'up' : rounded < 0 ? 'down' : '';
    return `<div class="change ${cls}">${rounded > 0 ? '▲' : rounded < 0 ? '▼' : '•'} ${Math.abs(rounded).toFixed(1)} pts vs previous</div>`;
  }

  function kpiHTML() {
    const t = stats.totals;
    const c = stats.changes || {};
    const tiles = [
      ['Posts', t.posts.toLocaleString('en-US'), changeHTML(c.posts)],
      ['Accounts reached', SC.formatNumber(t.reach), changeHTML(c.reach)],
      ['Views', SC.formatNumber(t.views), '<div class="change">&nbsp;</div>'],
      ['Engagement rate', SC.formatPct(t.engagementRate), pointsChangeHTML(c.engagementPoints)],
      ['Media mentions', stats.media.total.toLocaleString('en-US'), changeHTML(c.mentions)],
      ['Media outlets', stats.media.outletCount.toLocaleString('en-US'), '<div class="change">&nbsp;</div>'],
    ];
    return `<div class="kpis">${tiles.map(([label, value, change]) =>
      `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div>${change}</div>`).join('')}</div>
      <p class="muted" style="margin:8px 0 0">Engagement rate = interactions ÷ accounts reached. ${stats.boostedCount ? `${stats.boostedCount} likely boosted post${stats.boostedCount === 1 ? '' : 's'} included in totals.` : ''}</p>`;
  }

  // ── Executive summary ──
  function summaryKey() {
    return `${stats.range.id}|${stats.range.start}|${stats.range.end}`;
  }

  // The period part of the summary (overview, what's resonating, what to focus on next) follows the
  // selected time period. Strategic recommendations are saved once and stay the same for every period.
  function currentSummary() {
    const saved = data.summary;
    if (saved && saved.key === summaryKey()) return { summary: saved, source: saved.source };
    return { summary: SC.buildSummary(stats), source: 'auto' };
  }

  function currentRecommendations() {
    const strategy = data.strategy;
    if (strategy && Array.isArray(strategy.recommendations) && strategy.recommendations.length) {
      return { list: strategy.recommendations, saved: true, reviewedAt: strategy.reviewedAt || null };
    }
    return { list: SC.buildSummary(stats).recommendations, saved: false, reviewedAt: null };
  }

  function summaryHTML() {
    const { summary, source } = currentSummary();
    const recs = currentRecommendations();
    const label = source === 'ai' ? 'AI-written, reviewed' : source === 'analyst' ? 'Analyst summary' : source === 'edited' ? 'Edited' : 'Automatic';
    const admin = MODE === 'admin';
    const aiReady = Boolean(readStore('dashboard_ai_endpoint_v2', '') && readStore('dashboard_ai_token_v2', ''));
    const editingSummary = editing === 'summary';
    const editingRecs = editing === 'recs';
    const block = (title, field, wide) => `<div${wide ? ' class="wide"' : ''}><h3>${title}</h3>${editingSummary
      ? `<textarea data-field="${field}">${esc(summary[field])}</textarea>`
      : `<p>${esc(summary[field])}</p>`}</div>`;
    const reviewed = recs.reviewedAt ? `Last reviewed ${SC.formatDate(recs.reviewedAt)}` : 'Suggested automatically — edit and save to set them';
    return `
      <section class="block card" id="summary">
        <div class="section-head">
          <div><h2>Executive summary</h2><span class="badge">${label}</span>
            <span class="muted">&nbsp;${esc(stats.range.label)} · ${SC.formatDate(stats.range.start)} – ${SC.formatDate(stats.range.end)}</span></div>
          <div class="btn-row no-print">
            ${admin && !editing ? `<button class="btn" type="button" id="btn-edit">✏️ Edit summary</button>` : ''}
            ${editingSummary ? `<button class="btn" type="button" id="btn-cancel-edit">Cancel</button><button class="btn btn-primary" type="button" id="btn-save-edit">✓ Done</button>` : ''}
            ${admin && !editing && source !== 'auto' ? `<button class="btn" type="button" id="btn-reset-summary">↺ Back to automatic</button>` : ''}
            ${admin && !editing && aiReady ? `<button class="btn" type="button" id="btn-ai">✨ Rewrite with AI</button>` : ''}
            ${!editing ? `<button class="btn" type="button" id="btn-copy">📋 Copy</button>` : ''}
          </div>
        </div>
        <div class="summary-grid">
          ${block('Overview', 'overview', true)}
          ${block('What’s resonating', 'working')}
          ${block('What to focus on next', 'attention')}
        </div>
        ${admin && !editing && source !== 'auto' ? '<p class="muted" style="margin:12px 0 0">This written summary belongs to this date range. Other periods, and newer data, show the automatic summary.</p>' : ''}
        <div class="strategy">
          <div class="section-head">
            <div><h3>Strategic recommendations</h3><p class="muted" style="margin:0">${reviewed} · the same for every time period</p></div>
            <div class="btn-row no-print">
              ${admin && !editing ? `<button class="btn" type="button" id="btn-edit-recs">✏️ Edit recommendations</button>` : ''}
              ${editingRecs ? `<button class="btn" type="button" id="btn-cancel-edit">Cancel</button><button class="btn btn-primary" type="button" id="btn-save-recs">✓ Save</button>` : ''}
            </div>
          </div>
          ${editingRecs
            ? `<textarea data-field="recommendations">${esc(recs.list.join('\n'))}</textarea><p class="muted">One recommendation per line. Leave empty to go back to the automatic suggestions.</p>`
            : `<ol>${recs.list.map(r => `<li>${esc(r)}</li>`).join('')}</ol>`}
        </div>
      </section>`;
  }

  function storeSummary(summary, source) {
    data.summary = {
      key: summaryKey(),
      overview: summary.overview,
      working: summary.working,
      attention: summary.attention,
      source,
    };
    markChanged();
  }

  function storeRecommendations(list, source) {
    data.strategy = list.length ? { recommendations: list, reviewedAt: new Date().toISOString().slice(0, 10), source } : null;
    markChanged();
  }

  function cleanLines(text) {
    return String(text || '').split(/\n+/).map(r => r.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  }

  function bindSummary() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    const value = field => document.querySelector(`#summary textarea[data-field="${field}"]`).value.trim();
    on('btn-edit', () => { editing = 'summary'; render(); });
    on('btn-edit-recs', () => { editing = 'recs'; render(); });
    on('btn-cancel-edit', () => { editing = false; render(); });
    on('btn-save-edit', () => {
      const summary = { overview: value('overview'), working: value('working'), attention: value('attention') };
      editing = false;
      storeSummary(summary, 'edited');
    });
    on('btn-save-recs', () => {
      const list = cleanLines(value('recommendations'));
      editing = false;
      storeRecommendations(list, 'edited');
    });
    on('btn-reset-summary', () => {
      if (!confirm('Discard the written summary for this period and go back to the automatic one?')) return;
      data.summary = null;
      markChanged();
    });
    on('btn-ai', generateAISummary);
    on('btn-copy', async () => {
      const { summary } = currentSummary();
      const recs = currentRecommendations();
      const text = [
        `Executive summary — ${stats.range.label} (${SC.formatDate(stats.range.start)} – ${SC.formatDate(stats.range.end)})`,
        '', 'Overview', summary.overview,
        '', 'What’s resonating', summary.working,
        '', 'What to focus on next', summary.attention,
        '', 'Strategic recommendations', ...recs.list.map((r, i) => `${i + 1}. ${r}`),
        ...(stats.hasMedia ? ['', 'Media narrative', SC.mediaNarrative(stats)] : []),
      ].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        $('btn-copy').textContent = '✓ Copied';
      } catch (e) {
        window.prompt('Copy the summary:', text);
      }
    });
  }

  async function generateAISummary() {
    const endpoint = readStore('dashboard_ai_endpoint_v2', '');
    const token = readStore('dashboard_ai_token_v2', '');
    const button = $('btn-ai');
    button.disabled = true;
    button.textContent = 'Writing…';
    try {
      const recs = currentRecommendations();
      const response = await fetch(endpoint.endsWith('/summary') ? endpoint : endpoint + '/summary', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidence: SC.buildAIEvidence(stats),
          accountContext: readStore('dashboard_ai_context_v2', '') || '',
          currentRecommendations: recs.saved ? recs.list : [],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.summary) throw new Error(payload.error || `the AI writer returned ${response.status}`);
      const s = payload.summary;
      // Saved recommendations are only replaced by editing them; the AI only fills them in when none are saved.
      if (!recs.saved) {
        const text = String(s.recommendedDirection || '');
        const list = text.includes('\n') ? cleanLines(text) : text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(r => r.trim()).filter(Boolean);
        if (list.length) data.strategy = { recommendations: list, reviewedAt: new Date().toISOString().slice(0, 10), source: 'ai' };
      }
      storeSummary({ overview: s.performanceOverview, working: s.whatsWorking, attention: s.whatsNotWorking }, 'ai');
    } catch (error) {
      alert('AI rewrite failed: ' + error.message);
      button.disabled = false;
      button.textContent = '✨ Rewrite with AI';
    }
  }

  // ── Social section ──
  function socialHTML() {
    if (!stats.hasSocial) {
      return `<section class="block"><h2>Social media</h2><div class="card empty">No Facebook or Instagram posts in this period.</div></section>`;
    }
    const groupRows = groups => groups.map(g => `<tr>
        <td>${esc(g.label)}${g.reliable ? '' : ' <span class="tag">few posts</span>'}</td>
        <td class="num">${g.posts}</td><td class="num">${SC.formatNumber(g.medianReach)}</td><td class="num">${SC.formatPct(g.medianEngagement)}</td></tr>`).join('');
    const groupTable = groups => `<div class="table-wrap"><table>
        <thead><tr><th></th><th class="num">Posts</th><th class="num">Typical reach</th><th class="num">Typical engagement</th></tr></thead>
        <tbody>${groupRows(groups)}</tbody></table></div>`;
    const platformName = p => p === 'ig' ? 'Instagram' : 'Facebook';
    const topRows = stats.topPosts.map(p => `<tr>
        <td style="white-space:nowrap">${SC.formatDate(p.date)}</td>
        <td style="white-space:nowrap"><span class="dot ${p.platform}"></span>${platformName(p.platform)} ${esc(p.format)}${p.boosted ? '<span class="tag">likely boosted</span>' : ''}</td>
        <td class="caption">${safeUrl(p.permalink) ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.caption.slice(0, 140) || '(no caption)')}</a>` : esc(p.caption.slice(0, 140))}${p.caption.length > 140 ? '…' : ''}</td>
        <td class="num">${SC.formatNumber(p.reach)}</td><td class="num">${p.interactions.toLocaleString('en-US')}</td><td class="num">${SC.formatPct(p.engagementRate)}</td></tr>`).join('');
    const ig = stats.byPlatform.ig;
    const fb = stats.byPlatform.fb;
    return `
      <section class="block">
        <div class="section-head"><div><h2>Social media</h2>
          <p class="muted" style="margin:0"><span class="dot ig"></span>Instagram: ${ig.posts} posts, ${SC.formatNumber(ig.reach)} reached, ${SC.formatPct(ig.engagementRate)} engagement &nbsp;·&nbsp; <span class="dot fb"></span>Facebook: ${fb.posts} posts, ${SC.formatNumber(fb.reach)} reached, ${SC.formatPct(fb.engagementRate)} engagement</p></div></div>
        <div class="card">
          <h3>Accounts reached per month</h3>
          <div class="chart-box"><canvas id="chart-reach" aria-label="Accounts reached per month by platform" role="img"></canvas></div>
        </div>
        ${themeCardsHTML()}
        ${formatChartsHTML(groupTable)}
        <div class="card" style="margin-top:16px">
          <h3>Top posts by engagement</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Post</th><th>Caption</th><th class="num">Reach</th><th class="num">Interactions</th><th class="num">Engagement</th></tr></thead>
            <tbody>${topRows || '<tr><td colspan="6" class="muted">No posts with enough reach to rank.</td></tr>'}</tbody></table></div>
        </div>
      </section>`;
  }

  // ── Content theme cards ──
  function themeCardsHTML() {
    const order = SC.THEMES.map(t => t.label).concat('Other');
    const counts = new Map(stats.themeCounts.map(t => [t.label, t.count]));
    const organic = new Map(stats.themes.map(t => [t.label, t]));
    const total = stats.totals.posts || 1;
    const cards = order.filter(label => counts.has(label)).map(label => {
      const g = organic.get(label);
      const best = g && g.bestPost;
      return `<div class="card theme-card" style="--theme-color:${SC.themeColor(label)}">
        <div class="theme-label">${esc(label)}</div>
        <div class="theme-count">${counts.get(label)}</div>
        <div class="muted">posts · ${Math.round((counts.get(label) / total) * 100)}% of all posts</div>
        <div class="theme-metric"><strong>${g ? SC.formatNumber(g.medianReach) : '—'}</strong><span>Typical organic reach</span></div>
        <div class="theme-metric"><strong>${g ? SC.formatPct(g.medianEngagement) : '—'}</strong><span>Typical organic engagement</span></div>
        <div class="theme-foot">
          <span class="sample ${g && g.reliable ? 'ok' : ''}">${g && g.reliable ? 'Enough posts to compare' : 'Too few posts to compare'}</span>
          ${best && safeUrl(best.permalink) ? `<a href="${esc(best.permalink)}" target="_blank" rel="noopener">Best post ↗</a>` : ''}
        </div>
      </div>`;
    }).join('');
    const reliable = stats.themes.filter(g => g.reliable && g.label !== 'Other');
    const topEng = reliable.slice().sort((a, b) => b.medianEngagement - a.medianEngagement)[0];
    const topReach = reliable.slice().sort((a, b) => b.medianReach - a.medianReach)[0];
    const sentences = [];
    if (topEng) sentences.push(`<strong>${esc(topEng.label)}</strong> earns the strongest typical engagement (${SC.formatPct(topEng.medianEngagement)}).`);
    if (topReach) sentences.push(`<strong>${esc(topReach.label)}</strong> reaches the most people per post (typically ${SC.formatNumber(topReach.medianReach)}).`);
    if (!sentences.length) sentences.push('Not enough organic posts per theme in this period for a reliable comparison.');
    return `
      <div class="block-sub">
        <h3>Content themes</h3>
        <p class="muted" style="margin-top:0">${sentences.join(' ')} Themes are tagged automatically from caption keywords; boosted posts are left out of the “typical” figures.</p>
        <div class="theme-grid">${cards}</div>
      </div>`;
  }

  // ── Format charts ──
  function formatChartsHTML(groupTable) {
    const igFormats = stats.formats.filter(g => g.label.startsWith('Instagram') && g.followsPerPost !== null);
    const legend = '<p class="muted chart-legend"><span class="dot ig"></span>Instagram &nbsp; <span class="dot fb"></span>Facebook</p>';
    const box = (id, label, height) => `<div class="chart-box" style="height:${height}px"><canvas id="${id}" role="img" aria-label="${label}"></canvas></div>`;
    const barHeight = Math.max(180, stats.formats.length * 38 + 40);
    return `
      <div class="block-sub">
        <h3>Formats</h3>
        <p class="muted" style="margin-top:0">Organic posts only. “Typical” means the middle (median) post, so one viral post doesn't skew it. * = fewer than 5 posts, treat with caution.</p>
        <div class="grid-2">
          <div class="card"><h3>Which formats reach the most people</h3>${legend}${box('chart-format-reach', 'Typical reach by format', barHeight)}</div>
          <div class="card"><h3>Which formats earn the most engagement</h3>${legend}${box('chart-format-eng', 'Typical engagement rate by format', barHeight)}</div>
          <div class="card"><h3>How people respond to each format</h3><p class="muted chart-legend">Average per post</p>${box('chart-format-response', 'Average comments, shares and saves per post by format', barHeight + 30)}</div>
          <div class="card"><h3>Content mix</h3>${legend}${box('chart-format-mix', 'Number of posts by format', barHeight)}</div>
          ${igFormats.length ? `<div class="card"><h3>Which formats attract followers</h3><p class="muted chart-legend">Instagram follows per post</p>${box('chart-format-follows', 'Instagram follows per post by format', Math.max(150, igFormats.length * 38 + 40))}</div>` : ''}
          <div class="card"><h3>Best time to post</h3><p class="muted chart-legend">Typical engagement by day and time posted, in Bahamas time. Darker = stronger.</p>${heatmapHTML()}</div>
        </div>
        <details class="card" style="margin-top:16px"><summary><strong>Format numbers as a table</strong></summary>${groupTable(stats.formats)}</details>
      </div>`;
  }

  function heatmapHTML() {
    const h = stats.heatmap;
    const values = h.cells.flat().filter(c => c.posts >= 2).map(c => c.medianEngagement);
    if (!values.length) return '<p class="muted">Not enough posts with a publish time.</p>';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const rows = h.cells.map((row, i) => {
      if (!row.some(c => c.posts)) return '';
      return `<tr><th scope="row">${esc(h.blocks[i])}</th>${row.map(c => {
        if (c.posts < 2) return `<td class="heat empty" title="${c.posts ? '1 post — too few' : 'No posts'}">${c.posts ? '·' : ''}</td>`;
        const t = max > min ? (c.medianEngagement - min) / (max - min) : 1;
        const light = 92 - t * 62;
        return `<td class="heat" style="background:hsl(192 70% ${light}%);color:${light < 55 ? '#fff' : '#1a202c'}" title="${c.posts} posts · typical engagement ${SC.formatPct(c.medianEngagement)}">${SC.formatPct(c.medianEngagement)}</td>`;
      }).join('')}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="heatmap"><thead><tr><th></th>${h.days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="margin:6px 0 0">Cells with fewer than 2 posts are left blank.</p>`;
  }

  // ── Media section ──
  function mediaHTML() {
    const m = stats.media;
    if (!m.total) {
      return `<section class="block"><h2>Media coverage</h2><div class="card empty">${data.media.length
        ? 'No media mentions in this period. Try a longer period above.'
        : MODE === 'admin' ? 'No media coverage yet. Upload the PR activity workbook above.' : 'No media coverage has been recorded yet.'}</div></section>`;
    }
    const moments = m.moments.map(mo => `<li>
        <div class="when">${SC.formatDate(mo.date)} · ${mo.count} ${mo.count === 1 ? 'story' : 'stories'}</div>
        ${mo.items.slice(0, 3).map(item => `<div>${esc(item.outlet)}: ${safeUrl(item.url) ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>` : esc(item.title)}</div>`).join('')}
        ${mo.items.length > 3 ? `<div class="muted">+ ${mo.items.length - 3} more</div>` : ''}
      </li>`).join('');
    const maxOutlet = m.outlets[0] ? m.outlets[0].count : 1;
    const outlets = m.outlets.slice(0, 8).map(o => `<li>
        <span class="bar-label" title="${esc(o.label)}">${esc(o.label)}</span><span class="bar-count">${o.count}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (o.count / maxOutlet) * 100)}%"></div></div></li>`).join('');
    return `
      <section class="block" id="media">
        <div class="section-head"><div><h2>Media coverage</h2><p class="muted" style="margin:0">From the PR activity workbook. These are publication records, not audience measurements.</p></div></div>
        <div class="grid-2">
          <div class="card"><h3>Media narrative</h3><p class="narrative">${esc(SC.mediaNarrative(stats))}</p></div>
          <div class="card"><h3>Key moments</h3><p class="muted" style="margin-top:0">The days with the most coverage in this period.</p><ul class="moments">${moments}</ul></div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3>Mentions per month</h3><div class="chart-box"><canvas id="chart-media" aria-label="Media mentions per month" role="img"></canvas></div></div>
          <div class="card"><h3>Top outlets</h3><ul class="bars">${outlets}</ul></div>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="section-head"><h3 style="margin:0">All coverage in this period (${m.total})</h3>
            <input class="search no-print" id="media-search" type="search" placeholder="Search outlet or headline" value="${esc(mediaSearch)}"></div>
          <div id="media-table"></div>
        </div>
      </section>`;
  }

  function renderMediaTable() {
    const holder = $('media-table');
    if (!holder) return;
    const query = mediaSearch.trim().toLowerCase();
    const rows = data.media
      .filter(item => item.date >= stats.range.start && item.date <= stats.range.end)
      .filter(item => !query || (item.outlet + ' ' + item.title + ' ' + item.type + ' ' + item.theme).toLowerCase().includes(query));
    const shown = showAllMedia ? rows : rows.slice(0, 25);
    const hasType = rows.some(r => r.type);
    const hasTheme = rows.some(r => r.theme);
    const hasSentiment = rows.some(r => r.sentiment);
    holder.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Outlet</th><th>Headline</th>${hasType ? '<th>Type</th>' : ''}${hasTheme ? '<th>Theme</th>' : ''}${hasSentiment ? '<th>Tone</th>' : ''}</tr></thead>
      <tbody>${shown.map(item => `<tr>
        <td style="white-space:nowrap">${SC.formatDate(item.date)}</td><td>${esc(item.outlet)}</td>
        <td class="caption">${safeUrl(item.url) ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>` : esc(item.title)}</td>
        ${hasType ? `<td>${esc(item.type)}</td>` : ''}${hasTheme ? `<td>${esc(item.theme)}</td>` : ''}${hasSentiment ? `<td>${esc(item.sentiment)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="muted">No matches.</td></tr>'}</tbody>
      </table></div>
      ${rows.length > 25 ? `<div class="btn-row no-print" style="margin-top:10px"><button class="btn" type="button" id="btn-more-media">${showAllMedia ? 'Show fewer' : `Show all ${rows.length}`}</button></div>` : ''}`;
    const more = $('btn-more-media');
    if (more) more.addEventListener('click', () => { showAllMedia = !showAllMedia; renderMediaTable(); });
  }

  function bindMedia() {
    const search = $('media-search');
    if (search) search.addEventListener('input', () => { mediaSearch = search.value; renderMediaTable(); });
    renderMediaTable();
  }

  // ── Charts ──
  function drawCharts() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#5f6b6d';
    const months = stats.monthly;
    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#eef2f3' }, border: { display: false }, ticks: { callback: v => SC.formatNumber(v) } },
      },
    };
    const reachCanvas = $('chart-reach');
    if (reachCanvas) {
      charts.reach = new Chart(reachCanvas, {
        type: 'bar',
        data: {
          labels: months.map(r => r.label),
          datasets: [
            { label: 'Instagram', data: months.map(r => r.igReach), backgroundColor: COLORS.ig, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, borderColor: '#fff', borderWidth: { top: 2 } },
            { label: 'Facebook', data: months.map(r => r.fbReach), backgroundColor: COLORS.fb, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, borderColor: '#fff', borderWidth: { top: 2 } },
          ],
        },
        options: Object.assign({}, baseOptions, {
          scales: { x: Object.assign({ stacked: true }, baseOptions.scales.x), y: Object.assign({ stacked: true }, baseOptions.scales.y) },
        }),
      });
    }
    // Horizontal bar charts by format, coloured by platform.
    const platformColor = label => label.startsWith('Instagram') ? COLORS.ig : COLORS.fb;
    const hbar = (id, groups, valueOf, format) => {
      const canvas = $(id);
      if (!canvas || !groups.length) return;
      charts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: groups.map(g => g.label + (g.reliable === false ? ' *' : '')),
          datasets: [{ data: groups.map(valueOf), backgroundColor: groups.map(g => platformColor(g.label)), borderRadius: 4, maxBarThickness: 22 }],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => format(ctx.raw) + (groups[ctx.dataIndex].posts ? ` · ${groups[ctx.dataIndex].posts} posts` : '') } } },
          scales: {
            x: { beginAtZero: true, grid: { color: '#eef2f3' }, border: { display: false }, ticks: { callback: v => format(v) } },
            y: { grid: { display: false } },
          },
        },
      });
    };
    const byValue = key => stats.formats.slice().sort((a, b) => b[key] - a[key]);
    hbar('chart-format-reach', byValue('medianReach'), g => g.medianReach, v => SC.formatNumber(v));
    hbar('chart-format-eng', byValue('medianEngagement'), g => g.medianEngagement, v => SC.formatPct(v));
    hbar('chart-format-follows', stats.formats.filter(g => g.followsPerPost !== null).sort((a, b) => b.followsPerPost - a.followsPerPost), g => g.followsPerPost, v => (Math.round(v * 100) / 100).toString());
    hbar('chart-format-mix', stats.contentMix.map(m => ({ label: m.label, posts: m.count, count: m.count })), g => g.count, v => Math.round(v).toString());

    const responseCanvas = $('chart-format-response');
    if (responseCanvas) {
      const groups = stats.formats;
      const series = [
        { label: 'Comments', key: 'avgComments', color: '#0b87a6' },
        { label: 'Shares', key: 'avgShares', color: '#c27c0e' },
        { label: 'Saves (Instagram only)', key: 'avgSaves', color: '#7c5cd6' },
      ];
      charts.response = new Chart(responseCanvas, {
        type: 'bar',
        data: {
          labels: groups.map(g => g.label),
          datasets: series.map(s => ({ label: s.label, data: groups.map(g => g[s.key] === null ? null : Math.round(g[s.key] * 10) / 10), backgroundColor: s.color, borderRadius: 3, maxBarThickness: 12, borderColor: '#fff', borderWidth: 1 })),
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
          scales: { x: { beginAtZero: true, grid: { color: '#eef2f3' }, border: { display: false } }, y: { grid: { display: false } } },
        },
      });
    }

    const mediaCanvas = $('chart-media');
    if (mediaCanvas) {
      const mediaMonths = stats.media.months;
      charts.media = new Chart(mediaCanvas, {
        type: 'bar',
        data: {
          labels: mediaMonths.map(r => SC.monthLabel(r.label)),
          datasets: [{ label: 'Mentions', data: mediaMonths.map(r => r.count), backgroundColor: COLORS.media, borderRadius: 4, maxBarThickness: 28 }],
        },
        options: Object.assign({}, baseOptions, { plugins: { legend: { display: false } } }),
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
