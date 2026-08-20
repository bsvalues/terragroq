-- 0011: a Thread is a conversation (#762 CONVERSATION-FIRST).
--
-- Until now a "Thread" held only projected work objects; there was nowhere for the owner's words or
-- WilliamOS's replies to live, which is why every utterance had to become a goal. Messages are the
-- primary content of a Thread; work objects hang off the conversation, not the other way around.
--
-- Roles are the two voices the projection already understands ('owner', 'williamos'). Agent and
-- system voices arrive later by widening the check, the same way 0010 widened source kinds.

CREATE TABLE "workbench_thread_message" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "threadId" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workbench_thread_message_role_check" CHECK ("role" IN ('owner', 'williamos')),
  CONSTRAINT "workbench_thread_message_user_thread_fk"
    FOREIGN KEY ("userId", "threadId")
    REFERENCES "workbench_thread" ("userId", "id")
    ON DELETE CASCADE
);

CREATE INDEX "workbench_thread_message_thread_created_idx"
  ON "workbench_thread_message" ("userId", "threadId", "createdAt", "id");
