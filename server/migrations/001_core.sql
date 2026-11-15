-- Core catalogue: groups, miniatures, tags, status history, photos, settings.

CREATE TABLE groups (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  kind        TEXT,
  description TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE miniatures (
  id             INTEGER PRIMARY KEY,
  group_id       INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  description    TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'unassembled'
                 CHECK (status IN ('unassembled','assembled','primed','in_progress','finished')),
  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  acquired_on    TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_miniatures_group  ON miniatures(group_id);
CREATE INDEX idx_miniatures_status ON miniatures(status);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
);

CREATE TABLE miniature_tags (
  miniature_id INTEGER NOT NULL REFERENCES miniatures(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (miniature_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX idx_miniature_tags_tag ON miniature_tags(tag_id);

-- Every status change is recorded: monthly stats and achievements are derived from this.
CREATE TABLE status_events (
  id           INTEGER PRIMARY KEY,
  miniature_id INTEGER NOT NULL REFERENCES miniatures(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_at   TEXT NOT NULL
);
CREATE INDEX idx_status_events_time ON status_events(to_status, changed_at);
CREATE INDEX idx_status_events_mini ON status_events(miniature_id);

CREATE TABLE photos (
  id           INTEGER PRIMARY KEY,
  miniature_id INTEGER NOT NULL REFERENCES miniatures(id) ON DELETE CASCADE,
  path         TEXT NOT NULL UNIQUE,   -- relative to DATA_DIR, forward slashes
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  stage        TEXT,                   -- miniature status when the photo was taken
  caption      TEXT,
  taken_at     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_photos_mini ON photos(miniature_id, taken_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                  -- JSON
);
