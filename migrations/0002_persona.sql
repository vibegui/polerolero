-- Which character in the side's cast spoke this message. Nullable because rows
-- written before the cast existed have no answer, and backfilling a guess would
-- be worse than an honest null: the trace panel simply omits the line.
ALTER TABLE messages ADD COLUMN persona TEXT;
