-- Not every row in the feed is somebody arguing. A 'pause' row is the card that
-- says the fans went to sleep; it carries no argument and takes no side, but it
-- lives in the same table because it has to arrive in the stream in order, on
-- the same due_at clock as everything else.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message';
