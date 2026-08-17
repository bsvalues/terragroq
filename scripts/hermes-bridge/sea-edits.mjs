import fsDefault from "node:fs"
import path from "node:path"

/**
 * SEA — deterministic edit validate/apply/rollback (WO-WILLIAMOS-HERMES-KERNEL-V1 §4).
 *
 * §4's acceptance is "a worker edit lands only via SEA; an invalid edit rolls back with no partial
 * write". That is a RELIABILITY control, not a containment one: Pilot 0 found small local models
 * emit literal diff markers, raw tool-call JSON as text, and hallucinated paths.
 *
 * The Phase 0 reliability battery (docs/reports/hermes-kernel-sea-phase0-probe-2026-08-17.md)
 * measured what this module has to survive, on the real model:
 *   - an `oldText` matching TWO locations when told it must match one  → SEA_OLDTEXT_AMBIGUOUS
 *   - `newText` omitted entirely from the edit object                  → SEA_EDIT_SHAPE
 *   - the same edit emitted twice in one set                          → SEA_EDITS_OVERLAP
 *   - `\r\n` in oldText and `\n` in newText, in a CRLF file           → normalised, see below
 *   - prose claiming edits were "applied directly" when nothing was written
 *
 * The last one is why this module reads only the edit set and never the model's narration.
 *
 * Everything here is pure and host-side: no kernel, no container, no network.
 */

const EOL = /\r\n|\n/g

/** The file's own convention wins. The model does not get to decide line endings. */
function dominantEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf >= lf && crlf > 0 ? "\r\n" : "\n"
}

const toEol = (text, eol) => text.replace(EOL, eol)

function resolveInside(root, relative) {
  if (typeof relative !== "string" || relative.length === 0) return null
  if (path.isAbsolute(relative)) return null
  const rootReal = path.resolve(root)
  const target = path.resolve(rootReal, relative)
  const rel = path.relative(rootReal, target)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return target
}

function occurrences(haystack, needle) {
  if (needle.length === 0) return 0
  const found = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return found
    found.push(at)
    from = at + 1 // overlapping matches count: two edits could target the same region
  }
}

/**
 * Validate an edit set against the workspace. Nothing is written.
 *
 * Returns `{ ok, errors, plan }`. `plan` carries, per edit, the resolved target, the file's own
 * line ending, and the exact match offset — so `applyEditSet` never re-derives a match and cannot
 * drift from what was validated.
 */
export function validateEditSet(edits, root, { fsApi = fsDefault } = {}) {
  const errors = []
  const plan = []
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, errors: [{ code: "SEA_NO_EDITS", detail: "edit set is empty" }], plan }
  }
  const contents = new Map()

  edits.forEach((edit, index) => {
    // Shape first: the battery produced edits with no `newText` at all. An empty string is a
    // deletion and is legitimate; absent is not.
    if (!edit || typeof edit !== "object" || Array.isArray(edit)
      || typeof edit.path !== "string" || typeof edit.oldText !== "string" || typeof edit.newText !== "string"
      || edit.oldText.length === 0) {
      errors.push({ code: "SEA_EDIT_SHAPE", index, detail: "each edit needs string path, oldText (non-empty) and newText" })
      return
    }
    const target = resolveInside(root, edit.path)
    if (target === null) {
      errors.push({ code: "SEA_PATH_OUTSIDE_ROOT", index, path: edit.path })
      return
    }
    if (!contents.has(target)) {
      try { contents.set(target, fsApi.readFileSync(target, "utf8")) } catch { contents.set(target, null) }
    }
    const content = contents.get(target)
    if (content === null) {
      errors.push({ code: "SEA_PATH_NOT_FOUND", index, path: edit.path })
      return
    }
    const eol = dominantEol(content)
    const oldText = toEol(edit.oldText, eol)
    const at = occurrences(content, oldText)
    if (at.length !== 1) {
      errors.push({
        code: at.length === 0 ? "SEA_OLDTEXT_NOT_FOUND" : "SEA_OLDTEXT_AMBIGUOUS",
        index, path: edit.path, occurrences: at.length,
        // Phrased for the repair loop: this string is fed back to the model verbatim.
        detail: at.length === 0
          ? "oldText was not found; copy it byte-for-byte from the file"
          : `oldText matched ${at.length} locations; include more surrounding context so it matches exactly one`,
      })
      return
    }
    plan.push({ index, target, relative: edit.path, eol, start: at[0], end: at[0] + oldText.length, newText: toEol(edit.newText, eol) })
  })

  // Overlap is checked across the whole set, against ORIGINAL offsets, because edits are applied
  // against the original content. The battery emitted the identical edit twice.
  const byTarget = new Map()
  for (const item of plan) {
    const list = byTarget.get(item.target) ?? []
    list.push(item)
    byTarget.set(item.target, list)
  }
  for (const list of byTarget.values()) {
    const ordered = [...list].sort((a, b) => a.start - b.start)
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].start < ordered[i - 1].end) {
        errors.push({
          code: "SEA_EDITS_OVERLAP", index: ordered[i].index, path: ordered[i].relative,
          detail: `edit ${ordered[i].index} overlaps edit ${ordered[i - 1].index} in the same file`,
        })
      }
    }
  }

  return { ok: errors.length === 0, errors, plan }
}

/**
 * Validate, then apply atomically. On any failure — validation or write — the workspace is left
 * exactly as it was found, which is §4's "no partial write".
 */
export function applyEditSet(edits, root, { fsApi = fsDefault } = {}) {
  const validation = validateEditSet(edits, root, { fsApi })
  if (!validation.ok) return { ok: false, errors: validation.errors, changedPaths: [] }

  const byTarget = new Map()
  for (const item of validation.plan) {
    const list = byTarget.get(item.target) ?? []
    list.push(item)
    byTarget.set(item.target, list)
  }

  const restore = []
  const changedPaths = []
  try {
    for (const [target, list] of byTarget) {
      const original = fsApi.readFileSync(target, "utf8")
      let next = original
      // Apply back-to-front so earlier offsets stay valid.
      for (const item of [...list].sort((a, b) => b.start - a.start)) {
        next = next.slice(0, item.start) + item.newText + next.slice(item.end)
      }
      restore.push({ target, original })
      fsApi.writeFileSync(target, next)
      // Verify: read back what we believe we wrote. A write that silently did something else is a
      // failure, not a success.
      if (fsApi.readFileSync(target, "utf8") !== next) throw new Error(`verification failed for ${target}`)
      changedPaths.push(list[0].relative)
    }
  } catch (error) {
    for (const entry of restore) {
      try { fsApi.writeFileSync(entry.target, entry.original) } catch { /* best effort; reported below */ }
    }
    return {
      ok: false,
      errors: [{ code: "SEA_APPLY_FAILED", detail: String(error?.message ?? error), rolledBack: restore.map((entry) => entry.target) }],
      changedPaths: [],
    }
  }
  return { ok: true, errors: [], changedPaths }
}
