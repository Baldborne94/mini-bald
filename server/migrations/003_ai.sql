-- AI assistant: one row per request, so advice can be re-read and usage stays visible.

CREATE TABLE ai_runs (
  id            INTEGER PRIMARY KEY,
  miniature_id  INTEGER REFERENCES miniatures(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('recipe','feedback','tutorials')),
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  photo_id      INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  input_json    TEXT NOT NULL,          -- what was asked (never the image itself)
  output_json   TEXT,                   -- the validated result
  status        TEXT NOT NULL CHECK (status IN ('ok','error')),
  error         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ai_runs_mini ON ai_runs(miniature_id, created_at);
CREATE INDEX idx_recipes_ai_run ON recipes(ai_run_id);
