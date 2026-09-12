-- Which hot topic a message belongs to, or NULL for the standing argument trees.
-- The current run is derived from this column rather than kept in a state table:
-- the feed already reconstructs everything it needs from the last N rows, and a
-- second source of truth would be one more thing to get out of sync.
ALTER TABLE messages ADD COLUMN topic TEXT;
