-- Painting: paint inventory, shopping list, recipes with ordered steps, timed sessions.

CREATE TABLE paints (
  id         INTEGER PRIMARY KEY,
  brand      TEXT NOT NULL,
  range      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  type       TEXT,                     -- free text: base, layer, shade, contrast, metallic…
  color_hex  TEXT,
  stock      TEXT NOT NULL DEFAULT 'owned' CHECK (stock IN ('owned','low','out','wanted')),
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_paints_identity ON paints(brand COLLATE NOCASE, range COLLATE NOCASE, name COLLATE NOCASE);

-- miniature_id NULL = a reusable recipe in the library.
-- Applying a recipe to a miniature copies it: ticks and tweaks stay per miniature.
CREATE TABLE recipes (
  id               INTEGER PRIMARY KEY,
  miniature_id     INTEGER REFERENCES miniatures(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','copy')),
  source_recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  ai_run_id        INTEGER,            -- set by the AI assistant (Phase 3)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_recipes_mini ON recipes(miniature_id);

CREATE TABLE recipe_steps (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  phase       TEXT NOT NULL CHECK (phase IN ('prime','base','shade','layer','highlight','detail','basing','varnish','other')),
  area        TEXT,                    -- armour, cloak, skin…
  paint_id    INTEGER REFERENCES paints(id) ON DELETE SET NULL,
  paint_label TEXT,                    -- kept as text so a step survives the paint leaving the inventory
  technique   TEXT,
  notes       TEXT,
  done_at     TEXT
);
CREATE INDEX idx_steps_recipe ON recipe_steps(recipe_id, position);
CREATE INDEX idx_steps_paint ON recipe_steps(paint_id);

CREATE TABLE shopping_items (
  id         INTEGER PRIMARY KEY,
  paint_id   INTEGER REFERENCES paints(id) ON DELETE CASCADE,  -- NULL = free-text item (brushes, glue…)
  label      TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  bought_at  TEXT
);
CREATE INDEX idx_shopping_paint ON shopping_items(paint_id);

CREATE TABLE painting_sessions (
  id           INTEGER PRIMARY KEY,
  miniature_id INTEGER REFERENCES miniatures(id) ON DELETE SET NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,                   -- NULL = the timer is running
  duration_sec INTEGER,
  notes        TEXT
);
-- At most one running timer: every running row indexes the same value.
CREATE UNIQUE INDEX idx_one_running_session ON painting_sessions((ended_at IS NULL)) WHERE ended_at IS NULL;
CREATE INDEX idx_sessions_time ON painting_sessions(started_at);
CREATE INDEX idx_sessions_mini ON painting_sessions(miniature_id);
