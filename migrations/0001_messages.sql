-- One table. No secondary index on purpose: in SQLite an INTEGER PRIMARY KEY
-- *is* the rowid, so `WHERE id < ?1 ORDER BY id DESC LIMIT 40` is a backwards
-- rowid scan touching exactly 40 rows. An index on id would duplicate the
-- table's own B-tree. due_at is monotonic with id, so it needs no index either.
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  side       TEXT    NOT NULL CHECK (side IN ('lula', 'bolsonaro')),
  body       TEXT    NOT NULL,
  arg_id     TEXT    NOT NULL,
  -- When this message becomes visible. The API serves rows whose due_at is in
  -- the future; the client holds them and reveals them on a local timer. That
  -- is what makes one fetch buy 10-20 minutes and every viewer see the same
  -- message land on the same wall-clock second.
  due_at     INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
