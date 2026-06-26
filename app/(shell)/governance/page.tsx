import { getAuthorityGrants } from "@/app/actions/authority"
import { getLocks } from "@/app/actions/locks"
import { getConflicts } from "@/app/actions/conflicts"
import { getTruthClaims } from "@/app/actions/truth"
import { getParkedIdeas } from "@/app/actions/vault"
import { getAgentClaims } from "@/app/actions/agent-claims"
import { PageHeader } from "@/components/shell/page-header"
import { GovernanceView } from "@/components/governance/governance-view"

export const dynamic = "force-dynamic"

export default async function GovernancePage() {
  const [grants, locks, conflicts, truth, ideas, claims] = await Promise.all([
    getAuthorityGrants(),
    getLocks(),
    getConflicts(),
    getTruthClaims(),
    getParkedIdeas(),
    getAgentClaims(),
  ])

  return (
    <>
      <PageHeader
        title="Governance"
        description="The enforcement layer. Authority is granted explicitly, locks are released deliberately, conflicts block execution, truth must stay fresh, agent claims are untrusted until verified, and parked ideas cannot spawn work."
      />
      <GovernanceView
        grants={grants}
        locks={locks}
        conflicts={conflicts}
        truth={truth}
        ideas={ideas}
        claims={claims}
      />
    </>
  )
}
