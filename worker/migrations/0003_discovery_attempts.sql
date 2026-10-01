CREATE TABLE discovery_attempts (
  source_id TEXT NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  PRIMARY KEY(source_id,url)
);
