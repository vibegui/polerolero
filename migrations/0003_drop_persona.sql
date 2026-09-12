-- The per-message persona is gone. Each side is one ordinary voice again: the
-- cast of seven archetypes read as costume, with the model performing an accent
-- instead of making a case. Dropping the column rather than leaving it null
-- forever, so the API payload stops carrying a field nothing reads.
ALTER TABLE messages DROP COLUMN persona;
