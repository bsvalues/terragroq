import { isV12AcceptanceAuthorityScope } from "./v1-2-acceptance-authority"
import { isV12CampaignAuthorityScope } from "./v1-2-campaign-authority"

export function isProtectedV12AuthorityScope(scope: string): boolean {
  return isV12AcceptanceAuthorityScope(scope)
    || isV12CampaignAuthorityScope(scope)
}
