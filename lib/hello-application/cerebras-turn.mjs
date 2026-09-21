import {
  resolveCerebrasCredentialBridge,
  runCerebrasApplicationTurn,
} from "../applications/cerebras-turn.mjs"

export { resolveCerebrasCredentialBridge }

export function runCerebrasHelloTurn(options) {
  return runCerebrasApplicationTurn({
    ...options,
    application: {
      manifest: {
        id: "hello-application",
        displayName: "Hello Application",
        ai: { writablePaths: options?.allowedPaths },
      },
      manifestDigest: "0".repeat(64),
    },
    legacyEnvelope: true,
  })
}
