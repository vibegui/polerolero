-- One theme is always running. It holds 20-30 arguments, a side visibly decides
-- to change it, and each side carries a secret rhetorical objective while it
-- lasts. `outcome` is written when the theme closes and is what the closing card
-- reveals; a row with outcome IS NULL is the theme currently in play.
CREATE TABLE IF NOT EXISTS themes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject          TEXT    NOT NULL,
  kind             TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  opened_by        TEXT    NOT NULL,
  lula_goal        TEXT    NOT NULL,
  lula_target      TEXT,
  bolsonaro_goal   TEXT    NOT NULL,
  bolsonaro_target TEXT,
  started_at       INTEGER NOT NULL,
  ends_after       INTEGER NOT NULL,
  outcome          TEXT
);

ALTER TABLE messages ADD COLUMN theme_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_theme ON messages(theme_id);
