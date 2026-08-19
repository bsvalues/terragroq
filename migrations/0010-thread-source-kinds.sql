BEGIN;

-- #884: the thread source vocabulary and the table disagreed, which is why nothing ever bound.
--
-- lib/workbench/thread-projection.ts declares ThreadSourceKind as goal | outcome_queue_item |
-- work_order | conversation_message | governance_event | evidence_record | decision | event_log |
-- loop_run | artifact. The check constraint permitted exactly two of them: 'goal' and 'outcome'.
--
-- So the model was written for the general case and the table for the first one built. Binding a work
-- order -- the thing an objective actually is -- failed on a constraint nobody had revisited. The
-- constraint is widened to the vocabulary the code already declares, plus the two resource-shaped
-- kinds this outcome introduced, rather than dropped: an unconstrained sourceType would let any typo
-- become a source kind.

ALTER TABLE "workbench_thread_source" DROP CONSTRAINT IF EXISTS "workbench_thread_source_type_check";

ALTER TABLE "workbench_thread_source"
  ADD CONSTRAINT "workbench_thread_source_type_check"
  CHECK ("sourceType" IN (
    'goal',
    'outcome',
    'outcome_queue_item',
    'work_order',
    'conversation_message',
    'governance_event',
    'evidence_record',
    'decision',
    'event_log',
    'loop_run',
    'artifact',
    'resource',
    'reconciliation'
  ));

COMMIT;
