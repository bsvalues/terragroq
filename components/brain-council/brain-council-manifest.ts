import roles from "@/brain-council/BRAIN_COUNCIL_ROLES.json"
import releaseManifest from "@/brain-council/release/V1_5_1_RELEASE_MANIFEST.json"
import skills from "@/brain-council/SKILLS_REGISTRY.json"
import workflows from "@/brain-council/WORKFLOW_REGISTRY.json"

export type BrainCouncilRole = {
  id: string
  name: string
  authority: string
}

export type BrainCouncilManifestSummary = {
  roleCount: number
  skillCount: number
  workflowCount: number
  requiredFileCount: number
  roles: BrainCouncilRole[]
  releaseStatus: string
  definitionOnly: true
}

export function getBrainCouncilManifestSummary(): BrainCouncilManifestSummary {
  return {
    roleCount: roles.roles.length,
    skillCount: skills.skills.length,
    workflowCount: workflows.workflows.length,
    requiredFileCount: releaseManifest.required_files.length,
    roles: roles.roles,
    releaseStatus: releaseManifest.status,
    definitionOnly: true,
  }
}
