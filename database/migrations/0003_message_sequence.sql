-- AIMA — stable message ordering (Conversation Intelligence Sprint)
--
-- Ordering messages by created_at alone is not reliable: under READ
-- COMMITTED, now() is frozen at transaction start, so multiple inserts in
-- one transaction (e.g. a user message and its assistant reply, saved back
-- to back in ConversationService.sendMessage) can share an identical
-- timestamp, leaving their relative order in a LIMIT/ORDER BY query
-- undefined. A monotonic sequence column removes the ambiguity.

ALTER TABLE messages ADD COLUMN sequence BIGSERIAL;

CREATE INDEX idx_messages_conversation_sequence ON messages(conversation_id, sequence);
