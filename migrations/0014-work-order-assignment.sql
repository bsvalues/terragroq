-- 0014: work_order_assignment — who may actually act on owner-owned work.
--
-- P1, WORK_ORDER_DELEGATED_SUBJECT_UNRESOLVED. Work-order reads filtered on "userId" and every
-- mutation went through requireOwn(id, userId). work_order."agent" was read at create, at approval,
-- and as a grant label, but never in a WHERE clause -- so the server could hold approved work for an
-- agent and truthfully return none of it. Ownership was standing in for execution rights. They are
-- different questions and this table asks them separately.
--
-- P2, authority is not dispatch. An assignment is an OFFER until an executor accepts it. Declining
-- is routine, carries a typed reason, and ends the assignment -- never the work order, which stays
-- exactly where it is and becomes re-offerable. Accepted work carries a lease so that accepting and
-- then going silent cannot park an outcome indefinitely.
--
-- work_order."assignee" is deliberately left alone. It is a display string and too weak to become a
-- security boundary; this table is the boundary.

CREATE TABLE "work_order_assignment" (
  "id"              serial PRIMARY KEY,
  "workOrderId"     integer NOT NULL REFERENCES "work_order" ("id") ON DELETE CASCADE,

  -- The AUTHENTICATED identity that will act. Not a label, not a catalog name.
  "principal"       text NOT NULL,
  -- The catalog capability profile: codex | claude-code | copilot | local. A profile, not an
  -- identity -- several principals may share one, and one principal may act under several.
  "agentProfile"    text,
  "role"            text NOT NULL DEFAULT 'implementer',
  "status"          text NOT NULL DEFAULT 'offered',

  -- Required when status = 'declined'. Information for the router, not a failure record.
  "declineReason"   text,
  "declineDetail"   text,

  -- Accepted work must heartbeat or be reclaimed and re-offered.
  "leaseExpiresAt"  timestamptz,
  "heartbeatAt"     timestamptz,

  "assignedBy"      text,
  "assignedAt"      timestamptz NOT NULL DEFAULT now(),
  "acceptedAt"      timestamptz,
  "declinedAt"      timestamptz,
  "releasedAt"      timestamptz,
  "reclaimedAt"     timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_order_assignment_status_check" CHECK (
    "status" IN ('offered', 'accepted', 'active', 'declined', 'released', 'revoked')
  ),
  CONSTRAINT "work_order_assignment_role_check" CHECK (
    "role" IN ('implementer', 'reviewer', 'collaborator', 'subagent')
  ),
  CONSTRAINT "work_order_assignment_decline_reason_check" CHECK (
    "declineReason" IS NULL OR "declineReason" IN (
      'authority_insufficient',
      'capability_unavailable',
      'resource_unreachable',
      'conflict_of_interest',
      'capacity',
      'premise_invalid',
      'policy_refusal'
    )
  ),
  -- A decline without a reason is the thing this whole table exists to prevent: an executor
  -- disappearing from the loop without telling the router anything it can act on.
  CONSTRAINT "work_order_assignment_declined_needs_reason" CHECK (
    "status" <> 'declined' OR "declineReason" IS NOT NULL
  )
);

-- Resolving "what may this principal see and do" is on the hot path of every work-order read.
CREATE INDEX "work_order_assignment_principal_status_idx"
  ON "work_order_assignment" ("principal", "status", "workOrderId");

CREATE INDEX "work_order_assignment_wo_status_idx"
  ON "work_order_assignment" ("workOrderId", "status");

-- The reclaim sweep looks for live leases that have run out.
CREATE INDEX "work_order_assignment_lease_idx"
  ON "work_order_assignment" ("status", "leaseExpiresAt");

-- One principal holds at most one LIVE assignment per work order in a given role. Re-offering after
-- a decline or a reclaim is fine -- those rows are closed and stay as the routing record.
CREATE UNIQUE INDEX "work_order_assignment_live_unique"
  ON "work_order_assignment" ("workOrderId", "principal", "role")
  WHERE "status" IN ('offered', 'accepted', 'active');
