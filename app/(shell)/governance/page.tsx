import { getAuthorityGrants } from "@/app/actions/authority"
import { getLocks } from "@/app/actions/locks"
import { getConflicts } from "@/app/actions/conflicts"
import { getTruthClaims } from "@/app/actions/truth"
import { getParkedIdeas } from "@/app/actions/vault"
import { getAgentClaims } from "@/app/actions/agent-claims"
import { PageHeader } from "@/components/shell/page-header"
import { GovernanceNativeAreaPanel } from "@/components/governance/governance-native-area-panel"
import { AuthorityRegistryPanel } from "@/components/governance/authority-registry-panel"
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
        description="Primary Operator authority layer for scope, gates, evidence requirements, owner decisions, and denied authority."
      />
      <div className="flex flex-col gap-6 p-6 pb-0">
        <GovernanceNativeAreaPanel />
        <AuthorityRegistryPanel />
      </div>
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
