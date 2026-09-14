-- When a turn fails the guard twice, the fallback stops being the argument's
-- canned `claim` and becomes a PAST model rendering of the same argument. The
-- feed has already written thousands of those, so every argument arrives with a
-- library of phrasings instead of one sentence everybody has read before.
CREATE INDEX IF NOT EXISTS idx_messages_arg_id ON messages(arg_id);
