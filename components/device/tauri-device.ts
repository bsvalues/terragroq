type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

declare global {
  interface Window { __TAURI__?: { core?: { invoke?: TauriInvoke } } }
}

export function cockpitInvoke<T>(command: string, args?: Record<string, unknown>) {
  const invoke = window.__TAURI__?.core?.invoke
  if (!invoke) throw new Error("COCKPIT_NATIVE_UNAVAILABLE")
  return invoke<T>(command, args)
}

export function isNativeCockpit() {
  return typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function"
}

export async function devicePost<T>(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-williamos-device": "1" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(response.status === 429 ? "DEVICE_RATE_LIMITED" : "DEVICE_REQUEST_REJECTED")
  return response.json() as Promise<T>
}
