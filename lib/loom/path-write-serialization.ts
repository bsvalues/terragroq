import path from "node:path"

const writeTails = new Map<string, Promise<void>>()

function canonicalLockKey(absolutePath: string): string {
  if (!path.isAbsolute(absolutePath)) throw new Error("PATH_WRITE_LOCK_REQUIRES_ABSOLUTE_PATH")
  const normalized = path.normalize(absolutePath)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

/** Serialize every mutation lifecycle for one already-realpathed workspace file. */
export async function withPathWriteSerialization<T>(
  absolutePath: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = canonicalLockKey(absolutePath)
  const previous = writeTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  writeTails.set(key, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (writeTails.get(key) === tail) writeTails.delete(key)
  }
}
