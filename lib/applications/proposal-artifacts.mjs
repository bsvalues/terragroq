import fs from "node:fs"

const sameIdentity = (left, right) => String(left.dev) === String(right.dev)
  && String(left.ino) === String(right.ino)

/** Bounded, no-follow read for proposal/runtime artifacts. The pathname and
 * opened descriptor must remain the same singly-linked regular file. */
export function readBoundedRegularFile(target, { maxBytes, errorCode, allowMissing = false } = {}) {
  const fail = () => { throw new Error(errorCode || "APPLICATION_PROPOSAL_ARTIFACT_INVALID") }
  if (typeof target !== "string" || target.includes("\0") || !Number.isSafeInteger(maxBytes) || maxBytes < 1) return fail()
  let descriptor
  try {
    let before
    try { before = fs.lstatSync(target, { bigint: true }) }
    catch (error) {
      if (allowMissing && error?.code === "ENOENT") return null
      return fail()
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size < 0n || before.size > BigInt(maxBytes)) return fail()
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow)
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || opened.size !== before.size || !sameIdentity(opened, before)) return fail()
    const length = Number(opened.size)
    const bytes = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const count = fs.readSync(descriptor, bytes, offset, length - offset, offset)
      if (count <= 0) return fail()
      offset += count
    }
    const probe = Buffer.alloc(1)
    if (fs.readSync(descriptor, probe, 0, 1, length) !== 0) return fail()
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true })
    const afterPath = fs.lstatSync(target, { bigint: true })
    if (!afterDescriptor.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
      || afterDescriptor.nlink !== 1n || afterPath.nlink !== 1n
      || afterDescriptor.size !== opened.size || afterPath.size !== opened.size
      || !sameIdentity(opened, afterDescriptor) || !sameIdentity(afterDescriptor, afterPath)
      || afterDescriptor.mtimeNs !== opened.mtimeNs || afterDescriptor.ctimeNs !== opened.ctimeNs) return fail()
    return bytes
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null
    if (error?.message === errorCode) throw error
    return fail()
  } finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* read result already decided */ } }
}

export function readBoundedUtf8File(target, options) {
  const bytes = readBoundedRegularFile(target, options)
  if (bytes === null) return null
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { throw new Error(options?.errorCode || "APPLICATION_PROPOSAL_ARTIFACT_INVALID") }
}
