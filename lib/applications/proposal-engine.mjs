import {
  applicationRelativePathIdentity,
  normalizeApplicationRelativePath,
} from "./application-identity.mjs"

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const SAFE_APPLICATION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function canonicalPathList(value) {
  if (!Array.isArray(value)) return null
  try {
    const paths = value.map(normalizeApplicationRelativePath)
    return new Set(paths.map(applicationRelativePathIdentity)).size === paths.length ? paths : null
  } catch { return null }
}

function requestText(value, code) {
  if (typeof value !== "string") throw new Error(`${code}_REQUEST_INVALID`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2_000 || trimmed.includes("\0")) throw new Error(`${code}_REQUEST_INVALID`)
  return trimmed
}

/**
 * Descriptor-bound invariants shared by the legacy Hello lifecycle and V1 application proposals.
 * Git publication and durable receipt behavior live in the service built on this engine; this
 * small core deliberately contains no ambient filesystem or process state.
 */
export function createProposalEngine(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")
  const applicationId = input.applicationId
  const displayName = input.displayName
  const code = typeof input.errorPrefix === "string" && /^[A-Z][A-Z0-9_]{2,60}$/.test(input.errorPrefix)
    ? input.errorPrefix : "APPLICATION_PROPOSAL"
  if (typeof applicationId !== "string" || !SAFE_APPLICATION_ID.test(applicationId)
    || typeof displayName !== "string" || !displayName || displayName.trim() !== displayName
    || /[\u0000-\u001f\u007f]/.test(displayName)) throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")
  const allowedPaths = canonicalPathList(input.allowedPaths)
  const validationPaths = canonicalPathList(input.validationPaths)
  if (!allowedPaths?.length || !validationPaths
    || allowedPaths.some((item) => !validationPaths.includes(item))) throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")
  if (typeof input.validationCommand !== "string" || !input.validationCommand
    || /[\0\r\n]/.test(input.validationCommand)) throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")
  if (typeof input.namespace !== "string" || input.namespace.split("/").some((part) => !SAFE_SEGMENT.test(part))) {
    throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")
  }
  if (![2, 3, 4].includes(input.receiptSchemaVersion)) throw new Error("APPLICATION_PROPOSAL_DESCRIPTOR_INVALID")

  Object.freeze(allowedPaths)
  Object.freeze(validationPaths)
  const assertChangedPaths = (paths, ignored = []) => {
    if (!Array.isArray(ignored) || ignored.length) throw new Error(`${code}_IGNORED_PATH_REFUSED`)
    if (!Array.isArray(paths) || !paths.length) throw new Error(`${code}_NO_CHANGE`)
    if (new Set(paths).size !== paths.length) throw new Error(`${code}_PATH_REFUSED`)
    for (const item of paths) if (!allowedPaths.includes(item)) throw new Error(`${code}_PATH_REFUSED:${item}`)
    return [...paths].sort()
  }
  const governedPrompt = (value) => {
    const requested = requestText(value, code)
    if (input.promptKind === "hello-legacy") {
      return [
        "Implement the owner request below in the isolated Hello Application workspace.", `Owner request: ${requested}`,
        `You may modify a nonempty subset of only: ${allowedPaths.join(", ")}.`,
        "Preserve existing behavior outside the request. Do not create, delete, rename, or change modes of files.",
        "Do not run Git. Do not use network access. Do not install dependencies. Do not commit or push.",
        `The trusted host will run exactly: ${input.validationCommand} in a contained validator.`,
      ].join("\n")
    }
    return [
      `Implement the owner request below in the isolated ${displayName} (${applicationId}) application workspace.`,
      `Owner request: ${requested}`,
      `You may modify a nonempty subset of only: ${allowedPaths.join(", ")}.`,
      "Preserve existing behavior outside the request. Do not create, delete, rename, or change modes of files.",
      "Do not run Git. Do not use network access. Do not install dependencies. Do not commit or push.",
      `The trusted host will run exactly: ${input.validationCommand} in a contained validator.`,
    ].join("\n")
  }

  return Object.freeze({
    applicationId,
    displayName,
    allowedPaths,
    validationPaths,
    validationCommand: input.validationCommand,
    namespace: input.namespace,
    receiptSchemaVersion: input.receiptSchemaVersion,
    errorPrefix: code,
    assertChangedPaths,
    governedPrompt,
  })
}
