ALTER TABLE items ADD COLUMN superseded_by TEXT REFERENCES items(id);
CREATE INDEX items_superseded ON items(superseded_by);
