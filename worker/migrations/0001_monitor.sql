CREATE TABLE sources (id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, checked_at TEXT, success_at TEXT, error TEXT);
CREATE TABLE items (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, published_at TEXT, first_seen TEXT NOT NULL, changed_at TEXT NOT NULL, last_seen TEXT NOT NULL, content_hash TEXT NOT NULL, text TEXT NOT NULL, tags TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'unreviewed');
CREATE TABLE captures (item_id TEXT NOT NULL REFERENCES items(id), hash TEXT NOT NULL, captured_at TEXT NOT NULL, raw_html TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(item_id,hash));
CREATE TABLE recommendations (item_id TEXT PRIMARY KEY REFERENCES items(id), ai_text TEXT, draft TEXT, version INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, basis_hash TEXT, published TEXT, published_at TEXT, published_hash TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, item_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX items_changed ON items(changed_at DESC);
CREATE INDEX audit_item ON audit(item_id,id);
