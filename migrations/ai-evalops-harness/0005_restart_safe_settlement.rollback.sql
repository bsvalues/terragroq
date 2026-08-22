-- Disposable/pre-use reversal only.
DROP FUNCTION IF EXISTS ai_evalops.settle_descriptor(uuid,uuid,text,text,uuid);
DROP FUNCTION IF EXISTS ai_evalops.reconstruct_settlement_descriptor(uuid,text);
DROP FUNCTION IF EXISTS ai_evalops.issue_settlement_descriptor(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint);
DROP TABLE IF EXISTS ai_evalops.settlement_receipts;
DROP TABLE IF EXISTS ai_evalops.settlement_descriptors;
