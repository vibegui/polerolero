-- Callbacks read a random slice of messages from 1–14 days ago, once per cron
-- tick. Without an index that range predicate is a full table scan, and this
-- table grows ~1000 rows a day forever. id is monotonic with due_at today, but
-- only accidentally — the sleep window and pause rows make the mapping
-- non-linear, so the range has to be expressed on due_at itself.
CREATE INDEX IF NOT EXISTS idx_messages_due_at ON messages(due_at);
