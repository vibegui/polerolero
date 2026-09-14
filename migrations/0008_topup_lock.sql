-- Cron triggers are at-least-once. Two overlapping topUp runs both read the
-- same newest row, both compute their own gap from it, and both append: the
-- feed got two lula messages one second apart carrying the SAME arg_id, and
-- every duplicated turn is a duplicated model call on the bill.
--
-- A lease, not a mutex: `until` is a deadline, so a run that crashes or is
-- evicted mid-flight cannot wedge generation forever — the next tick past the
-- deadline simply takes it.
CREATE TABLE IF NOT EXISTS locks (
  name  TEXT    PRIMARY KEY,
  until INTEGER NOT NULL
);
INSERT OR IGNORE INTO locks (name, until) VALUES ('topup', 0);
