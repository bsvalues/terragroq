export interface DeviceCredential {
  credentialId: string
  /** base64 (not base64url) DER PKCS#8 for the ed25519 private key. */
  privateKeyPkcs8: string
}

export interface DeviceSession {
  cookie: string
  origin: string
  expiresAt: string | null
}

export interface JsonResponse {
  status: number
  json: Record<string, unknown> | null
  text: string
  setCookie: string[]
}

export declare const DEFAULT_COCKPIT: string
export declare function loadDeviceCredential(file?: string): DeviceCredential
export declare function requestJson(
  url: string,
  options?: { method?: string; body?: unknown; cookie?: string; origin?: string },
): Promise<JsonResponse>
export declare function openDeviceSession(options?: {
  baseUrl?: string
  credential?: DeviceCredential
  projectRoot?: string
}): Promise<DeviceSession>
