// #997 MIGRATION — ranged zip probe.
//
// Downloading nine 2 GB release archives to read one DLL's version resource timed the previous
// attempt out at 540 s. A zip's central directory is at the END of the file and every entry records
// its own offset, so the same question can be answered with three small Range requests per release:
// the tail, the central directory, and the ~700 KB of one compressed member. That turns a ~60 s
// probe into a ~2 s one, which is what makes scanning the whole history affordable.
//
// Everything here is read-only against GitHub's CDN. The only local write is the single DLL whose
// version resource PowerShell then reads, into a scratch path the caller deletes.
import fs from "node:fs"
import zlib from "node:zlib"

const OUT = process.argv[2]
const tags = process.argv.slice(3)

async function range(url, from, to) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } })
  if (!res.ok && res.status !== 206) throw new Error(`range ${from}-${to} -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function probe(tag) {
  const url = `https://github.com/ollama/ollama/releases/download/${tag}/ollama-windows-amd64.zip`
  const head = await fetch(url, { method: "HEAD", redirect: "follow" })
  if (!head.ok) return { tag, error: `HEAD ${head.status}` }
  const size = Number(head.headers.get("content-length"))
  const final = head.url

  // End-of-central-directory lives in the last 64 KB at most (it is followed only by the comment).
  const tail = await range(final, Math.max(0, size - 65_557), size - 1)
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) return { tag, size, error: "no EOCD" }
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOff = tail.readUInt32LE(eocd + 16)
  if (cdOff === 0xffffffff) return { tag, size, error: "zip64 (not handled)" }

  const cd = await range(final, cdOff, cdOff + cdSize - 1)
  const entries = []
  let p = 0
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10)
    const compSize = cd.readUInt32LE(p + 20)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const cmtLen = cd.readUInt16LE(p + 32)
    const lho = cd.readUInt32LE(p + 42)
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen)
    entries.push({ name, method, compSize, lho })
    p += 46 + nameLen + extraLen + cmtLen
  }

  const runnerDirs = [...new Set(entries.map((e) => /^lib\/ollama\/([^/]+)\//.exec(e.name)?.[1]).filter(Boolean))].sort()
  // EVERY cudart, not just the first: the v0.6-v0.9 packages ship cuda_v11 AND cuda_v12, and it is
  // precisely the second one that decides whether Ollama would pick a runner this driver rejects.
  const dlls = entries.filter((e) => /cudart64_\d+\.dll$/i.test(e.name))
  const out = { tag, size, runnerDirs, cudartEntries: dlls.map((d) => d.name), entryCount: entries.length }
  for (const dll of dlls) {
    const lh = await range(final, dll.lho, dll.lho + 29)
    const dataStart = dll.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
    const raw = await range(final, dataStart, dataStart + dll.compSize - 1)
    const bytes = dll.method === 0 ? raw : zlib.inflateRawSync(raw)
    const safe = dll.name.replace(/[\\/]/g, "_")
    fs.writeFileSync(`${OUT}\\${tag}__${safe}`, bytes)
  }
  return out
}

const results = []
for (const tag of tags) {
  try {
    results.push(await probe(tag))
  } catch (error) {
    results.push({ tag, error: String(error.message) })
  }
}
fs.writeFileSync(`${OUT}\\zipprobe.json`, JSON.stringify(results, null, 2))
for (const r of results) {
  console.log(`TAG ${r.tag} size=${r.size ?? "-"} dirs=${(r.runnerDirs ?? []).join(",")} cudart=${r.cudartEntry ?? "-"} err=${r.error ?? "-"}`)
}
