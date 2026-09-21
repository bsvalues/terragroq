import type { HelloApplicationRuntimeSnapshot } from "./runtime-supervisor"

export type HelloApplicationBrowserRuntime = Readonly<{
  state: HelloApplicationRuntimeSnapshot["state"]
  pid: number | null
  url: string | null
  error: string | null
}>

const SAFE_RUNTIME_ERROR = /^(?:HELLO_APPLICATION|APPLICATION)_[A-Z0-9_]{1,80}$/

function admittedErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.split(":", 1)[0]
  return SAFE_RUNTIME_ERROR.test(code) ? code : null
}

export function projectHelloApplicationRuntime(
  snapshot: HelloApplicationRuntimeSnapshot,
): HelloApplicationBrowserRuntime {
  return {
    state: snapshot.state,
    pid: snapshot.pid,
    url: snapshot.url,
    error: snapshot.error === null
      ? null
      : admittedErrorCode(snapshot.error) ?? "HELLO_APPLICATION_RUNTIME_FAILED",
  }
}

export function projectHelloApplicationStartError(error: unknown): string {
  const value = error instanceof Error ? error.message : error
  return admittedErrorCode(value) ?? "HELLO_APPLICATION_START_FAILED"
}

export function projectHelloApplicationStopError(error: unknown): string {
  const value = error instanceof Error ? error.message : error
  return admittedErrorCode(value) ?? "HELLO_APPLICATION_STOP_FAILED"
}
