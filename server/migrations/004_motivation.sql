-- Motivation: unlocked achievements and personal challenges.
-- Streaks, the pile of shame and statistics are computed from existing tables.

CREATE TABLE achievement_unlocks (
  key         TEXT PRIMARY KEY,        -- the definitions live in code (services/motivation.ts)
  unlocked_at TEXT NOT NULL,
  seen_at     TEXT                     -- NULL until the celebration has been shown once
);

CREATE TABLE challenges (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('finish_miniatures','finish_count','paint_hours','streak_days')),
  target       INTEGER,                -- models, hours or days; unused for finish_miniatures
  group_id     INTEGER REFERENCES groups(id) ON DELETE SET NULL,  -- optional scope for finish_count
  starts_on    TEXT NOT NULL,          -- YYYY-MM-DD, local
  due_on       TEXT,                   -- YYYY-MM-DD, local, inclusive
  completed_at TEXT,
  abandoned_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE challenge_miniatures (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  miniature_id INTEGER NOT NULL REFERENCES miniatures(id) ON DELETE CASCADE,
  PRIMARY KEY (challenge_id, miniature_id)
) WITHOUT ROWID;
