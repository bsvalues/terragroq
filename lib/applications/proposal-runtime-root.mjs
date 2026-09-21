import fs from "node:fs"
import path from "node:path"

const containsPath = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

const samePath = (left, right) => process.platform === "win32"
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right)

function rejectLinkedPath(target, allowMissing = false) {
  const absolute = path.resolve(target)
  const volume = path.parse(absolute).root
  let cursor = volume
  for (const segment of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    let stat
    try { stat = fs.lstatSync(cursor) }
    catch (error) {
      if (allowMissing && error?.code === "ENOENT") return
      throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    }
    if (stat.isSymbolicLink()) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
}

export function resolveApplicationProposalRuntimeRoot(runtimeRoot, repositoryRoot) {
  if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot) || runtimeRoot.includes("\0")) {
    throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
  const root = path.resolve(runtimeRoot)
  const platform = path.resolve(process.env.WILLIAMOS_PROJECT_ROOT?.trim() || process.cwd())
  const excluded = [platform, process.cwd()]
  if (repositoryRoot !== undefined) {
    if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    excluded.push(path.resolve(repositoryRoot))
  }
  for (const key of ["WILLIAMOS_APPLICATIONS_ROOT", "WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT", "WILLIAMOS_APPLICATION_ASSET_ROOT"]) {
    const configured = process.env[key]?.trim()
    if (!configured) continue
    if (!path.isAbsolute(configured) || configured.includes("\0")) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    excluded.push(path.resolve(configured))
  }
  for (let ancestor = path.dirname(platform); ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
    try { if (fs.lstatSync(path.join(ancestor, ".git")).isDirectory()) excluded.push(ancestor) }
    catch (error) { if (error?.code !== "ENOENT") throw new Error("APPLICATION_RUNTIME_ROOT_INVALID") }
  }
  if (excluded.some((target) => containsPath(target, root) || containsPath(root, target))) {
    throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
  rejectLinkedPath(root, true)
  return root
}

/**
 * Validate a derived proposal-runtime path before it is used.  The runtime
 * root alone is not a sufficient boundary: an attacker could replace a
 * proposal or lock descendant with a junction after the root was selected.
 */
export function assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing = false } = {}) {
  const root = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  if (typeof target !== "string" || !path.isAbsolute(target) || target.includes("\0")) {
    throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
  const absolute = path.resolve(target)
  if (samePath(root, absolute) || !containsPath(root, absolute)) {
    throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
  rejectLinkedPath(root, allowMissing)
  rejectLinkedPath(absolute, allowMissing)
  try {
    const realRoot = fs.realpathSync(root)
    const realTarget = fs.realpathSync(absolute)
    if (!samePath(root, realRoot) || !samePath(absolute, realTarget) || !containsPath(realRoot, realTarget)) {
      throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    }
  } catch (error) {
    if (!(allowMissing && error?.code === "ENOENT")) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
  }
  return absolute
}
