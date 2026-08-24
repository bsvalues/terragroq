/**
 * Review-register integrity.
 *
 * A review response register is a table whose rows point into the body of the same document: a
 * finding, a verdict, and a cell naming where the correction landed. The Experience V2 Phase 0
 * collision map has failed to maintain that structure by hand three review rounds running -- §12
 * rows 32-34 and §13 rows 42, 45 are all one defect, a "where corrected" cell naming a correction
 * the body does not contain. The map's own conclusion was that a register pointing into a body is a
 * data structure with no integrity check. This is the check.
 *
 * WHAT IT VERIFIES (mechanically, completely):
 *   - every register row number is unique within its register, and each register's numbers run
 *     contiguously (row numbers are namespaced per register: §10 runs 1-24, §11 restarts at 1);
 *   - every row's target cell is non-empty and names at least one resolvable target;
 *   - every section reference in the whole document resolves to a real heading, or to a real
 *     numbered list item where the document uses list items as sections (§6.7, §7.5 invariant 13);
 *   - every `§N row K` cross-reference resolves to a row that actually exists in register §N;
 *   - every pinned row's quoted pin text is present in the resolved target's own text.
 *
 * WHAT IT DOES NOT VERIFY, stated because this program's defect class is exactly the unstated
 * limit: it cannot tell whether a correction is *correct*, or whether an unpinned target section
 * genuinely answers the finding. Reference resolution catches deletion (row 34's failure) and
 * typos. Pins catch a target that still carries the withdrawn wording (row 32's failure). Neither
 * catches a section that exists, differs from the pin, and still fails to answer the row. Only
 * review does that. Passing this check is not evidence that a register is honest.
 */

export interface RegisterRow {
  /** Register section the row lives in, e.g. "13". */
  register: string
  /** Row number as written in the first cell. */
  row: number
  /** 1-based line number in the source document. */
  line: number
  /** The final cell: where the correction is claimed to have landed. */
  target: string
  /** The row's own source line, excluded when matching pins so a pin cannot match itself. */
  raw: string
}

export interface SectionRef {
  /** The reference as written, without the section sign, e.g. "7.5" or "6.7". */
  ref: string
  /** Sub-target kind when the reference names one, e.g. "invariant" or "item". */
  subKind?: string
  /** Sub-target ordinal when the reference names one. */
  subIndex?: number
  line: number
  raw: string
}

export interface Violation {
  kind:
    | "DUPLICATE_ROW"
    | "ROW_SEQUENCE_GAP"
    | "EMPTY_TARGET"
    | "UNRESOLVABLE_TARGET"
    | "DANGLING_SECTION_REF"
    | "DANGLING_ROW_REF"
    | "PIN_NOT_PRESENT"
    | "MISSING_PIN"
  line: number
  detail: string
}

export interface Section {
  /** Dotted number, e.g. "7" or "7.5". */
  number: string
  title: string
  startLine: number
  endLine: number
  /** Text of the section excluding nested subsections. */
  ownText: string
  /** Top-level numbered list items, keyed by their printed ordinal. */
  items: Map<number, string>
}

const HEADING = /^(#{2,6})\s+(\d+(?:\.\d+)*)\.?\s+(.*)$/
const ROW = /^\|\s*(\d+)\s*\|/
/** "§7.5", "§7.5 invariant 13", "§6.7 item 7", "§11 row 20". */
const SECTION_REF = /§\s*(\d+(?:\.\d+)*)(?:\s+(invariant|item|row)s?\s+(\d+))?/g
/** Optional pin clause in a target cell: `pin: "..."` or `pin: "a", "b"`. */
const PIN_CLAUSE = /\bpin:\s*((?:"[^"]+"\s*,?\s*)+)/
const PIN_TEXT = /"([^"]+)"/g

/**
 * A numbered list item that opens a line at zero indentation. Continuation lines (indented, or
 * table rows belonging to the item) are folded into the item's text so a pin may cite them.
 */
const LIST_ITEM = /^(\d+)\.\s+(.*)$/

const LINE_BREAK = "\n"

export function parseSections(markdown: string | readonly string[]): Map<string, Section> {
  const lines = typeof markdown === "string" ? markdown.split(LINE_BREAK) : markdown
  const sections = new Map<string, Section>()
  const opened: Section[] = []

  const close = (section: Section, endLine: number) => {
    section.endLine = endLine
    section.ownText = lines.slice(section.startLine, section.endLine).join("\n")
    section.items = parseItems(lines.slice(section.startLine, section.endLine))
  }

  lines.forEach((line, index) => {
    const heading = HEADING.exec(line)
    if (!heading) return
    const [, , number, title] = heading
    while (opened.length > 0) {
      const last = opened[opened.length - 1]
      if (number.startsWith(`${last.number}.`)) break
      close(last, index)
      opened.pop()
    }
    const section: Section = {
      number,
      title,
      startLine: index + 1,
      endLine: lines.length,
      ownText: "",
      items: new Map(),
    }
    sections.set(number, section)
    opened.push(section)
  })

  // A section's own text stops at its first subsection; sections still open at EOF end there.
  for (const section of opened) close(section, lines.length)
  for (const section of sections.values()) {
    if (section.ownText === "") close(section, section.endLine)
  }
  return sections
}

function parseItems(body: readonly string[]): Map<number, string> {
  const items = new Map<number, string>()
  let current: number | null = null
  let buffer: string[] = []
  const flush = () => {
    if (current !== null) items.set(current, buffer.join("\n"))
    current = null
    buffer = []
  }
  for (const line of body) {
    const match = LIST_ITEM.exec(line)
    if (match) {
      flush()
      current = Number(match[1])
      buffer = [match[2]]
      continue
    }
    if (current !== null) {
      // Blank lines and indented continuations stay with the item; a new unindented paragraph
      // ends it, because it is no longer part of the numbered entry.
      if (line.trim() === "" || /^\s/.test(line)) {
        buffer.push(line)
        continue
      }
      flush()
    }
  }
  flush()
  return items
}

/**
 * A register is found by structure, not by its title. §12 is called "Revision-3 self-check" and
 * declares rows 32-35; §13 is called a register and declares 36-46. Keying on the word would have
 * silently excluded §12 from every rule below, which is the failure mode this module exists to
 * catch, one level up.
 */
const MIN_REGISTER_ROWS = 3
/** A register row carries at least a number, a finding, a verdict and a target. */
const MIN_REGISTER_COLUMNS = 4

export function parseRegisterRows(markdown: string): RegisterRow[] {
  const lines = markdown.split(LINE_BREAK)
  const rows: RegisterRow[] = []
  let register: string | null = null
  const perSection = new Map<string, RegisterRow[]>()

  lines.forEach((line, index) => {
    if (/^##\s/.test(line)) {
      const heading = HEADING.exec(line)
      register = heading ? heading[2] : null
    }
    if (register === null) return
    const match = ROW.exec(line)
    if (!match) return
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(" | ").map((cell) => cell.trim())
    // The sweep sub-table inside §12 annotates existing §10 rows rather than declaring new ones;
    // it has three columns where a register row has five or six.
    if (cells.length < MIN_REGISTER_COLUMNS) return
    const collected = perSection.get(register) ?? []
    collected.push({
      register,
      row: Number(match[1]),
      line: index + 1,
      target: cells[cells.length - 1],
      raw: line,
    })
    perSection.set(register, collected)
  })

  for (const collected of perSection.values()) {
    if (collected.length >= MIN_REGISTER_ROWS) rows.push(...collected)
  }
  return rows.sort((left, right) => left.line - right.line)
}

export function collectSectionRefs(markdown: string): SectionRef[] {
  const refs: SectionRef[] = []
  markdown.split("\n").forEach((line, index) => {
    SECTION_REF.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SECTION_REF.exec(line)) !== null) {
      refs.push({
        ref: match[1],
        subKind: match[2],
        subIndex: match[3] === undefined ? undefined : Number(match[3]),
        line: index + 1,
        raw: match[0],
      })
    }
  })
  return refs
}

/**
 * Resolve a section reference to the text it names, or null when nothing answers it.
 *
 * A dotted reference resolves to a heading when one exists and otherwise to a numbered list item
 * of its parent -- the map writes §6.7 for item 7 of §6, which has no heading of its own. That
 * fallback is the case row 34 turned on: deleting item 7 leaves §6 standing and §6.7 dangling.
 */
export function resolveSectionRef(
  ref: SectionRef,
  sections: Map<string, Section>,
): { text: string } | null {
  const direct = sections.get(ref.ref)
  let text: string | null = direct ? direct.ownText : null

  if (text === null) {
    const dot = ref.ref.lastIndexOf(".")
    if (dot === -1) return null
    const parent = sections.get(ref.ref.slice(0, dot))
    const ordinal = Number(ref.ref.slice(dot + 1))
    const item = parent?.items.get(ordinal)
    if (item === undefined) return null
    text = item
  }

  if (ref.subKind === undefined || ref.subIndex === undefined) return { text }
  if (ref.subKind === "row") return { text }

  // "invariant 13" / "item 7" name a numbered entry inside the resolved section. When the
  // reference already resolved *through* a list item (§6.7 item 7), the ordinals agree and the
  // item text is the answer; otherwise the entry is looked up in the section's own list.
  if (direct === undefined) {
    const dot = ref.ref.lastIndexOf(".")
    return Number(ref.ref.slice(dot + 1)) === ref.subIndex ? { text } : null
  }
  const entry = direct.items.get(ref.subIndex)
  return entry === undefined ? null : { text: entry }
}

/**
 * Pins are matched on whitespace-normalised text. The map wraps at 100 columns, so a phrase worth
 * pinning routinely straddles a line break; a literal match would make the mechanism depend on
 * reflow rather than on content.
 */
function normalise(text: string): string {
  // Blockquote markers go too: the map quotes the charter across wrapped `> ` lines, and a pin
  // should match the quoted sentence rather than the fact that it was indented.
  return text
    .split(LINE_BREAK)
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function pinsOf(target: string): string[] {
  const clause = PIN_CLAUSE.exec(target)
  if (!clause) return []
  const pins: string[] = []
  PIN_TEXT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PIN_TEXT.exec(clause[1])) !== null) pins.push(match[1])
  return pins
}

/**
 * Registers at or above this number must pin every row. §10 and §11 predate the mechanism and are
 * carved out explicitly rather than silently: their coverage is reported, not assumed.
 */
export const PIN_REQUIRED_FROM_REGISTER = 12

export interface RegisterReport {
  rows: RegisterRow[]
  violations: Violation[]
  pinnedRows: number
  unpinnedLegacyRows: number
}

export function checkReviewRegister(markdown: string): RegisterReport {
  const lines = markdown.split("\n")
  const sections = parseSections(lines)
  const rows = parseRegisterRows(markdown)
  const violations: Violation[] = []

  // Row numbers are namespaced per register, not globally: §10 numbers its own findings 1-24 and
  // §11 restarts at 1, while §12 and §13 continue §11's sequence. Every cross-reference in the
  // document is therefore register-qualified (`§11 row 20`), and uniqueness and contiguity are
  // per-register properties. A global rule would be simpler and would be wrong about this document.
  const rowsByRegister = new Map<string, Map<number, RegisterRow>>()
  for (const row of rows) {
    const declared = rowsByRegister.get(row.register) ?? new Map<number, RegisterRow>()
    const prior = declared.get(row.row)
    if (prior) {
      violations.push({
        kind: "DUPLICATE_ROW",
        line: row.line,
        detail: `§${row.register} declares row ${row.row} twice (also at line ${prior.line})`,
      })
    } else {
      declared.set(row.row, row)
    }
    rowsByRegister.set(row.register, declared)
  }

  for (const [register, declared] of rowsByRegister) {
    const numbers = [...declared.keys()].sort((left, right) => left - right)
    numbers.forEach((value, index) => {
      if (index === 0 || value === numbers[index - 1] + 1) return
      violations.push({
        kind: "ROW_SEQUENCE_GAP",
        line: declared.get(value)!.line,
        detail: `§${register}'s rows must run contiguously; row ${value} follows ${numbers[index - 1]}`,
      })
    })
  }

  // Every section reference in the document, not only those inside registers. A body paragraph
  // citing a section that no longer exists is the same defect one level out.
  for (const ref of collectSectionRefs(markdown)) {
    if (ref.subKind === "row") {
      const declared = rowsByRegister.get(ref.ref)
      if (declared === undefined) {
        violations.push({
          kind: "DANGLING_ROW_REF",
          line: ref.line,
          detail: `${ref.raw} cites §${ref.ref}, which is not a review register`,
        })
        continue
      }
      if (!declared.has(ref.subIndex!)) {
        violations.push({
          kind: "DANGLING_ROW_REF",
          line: ref.line,
          detail: `${ref.raw} cites a row §${ref.ref} does not declare`,
        })
      }
      continue
    }
    if (resolveSectionRef(ref, sections) === null) {
      violations.push({
        kind: "DANGLING_SECTION_REF",
        line: ref.line,
        detail: `${ref.raw} resolves to no heading and no numbered item`,
      })
    }
  }

  let pinnedRows = 0
  let unpinnedLegacyRows = 0

  for (const row of rows) {
    const target = row.target
    if (target === "" || target === "-" || target === "—") {
      violations.push({ kind: "EMPTY_TARGET", line: row.line, detail: `row ${row.row} names no target` })
      continue
    }

    const refs = collectSectionRefs(target).filter((ref) => ref.subKind !== "row")
    const external = /(?:#\d{2,}|`[A-Z][A-Z0-9-]{6,}`|\b[0-9a-f]{7,40}\b)/.test(target)
    if (refs.length === 0 && !external) {
      violations.push({
        kind: "UNRESOLVABLE_TARGET",
        line: row.line,
        detail: `row ${row.row}'s target names no section, packet, PR or commit: ${target}`,
      })
      continue
    }

    const pins = pinsOf(target)
    const pinRequired = Number(row.register) >= PIN_REQUIRED_FROM_REGISTER
    if (pins.length === 0) {
      if (pinRequired) {
        violations.push({
          kind: "MISSING_PIN",
          line: row.line,
          detail: `row ${row.row} is in §${row.register} and must carry pin: "..." naming text its target contains`,
        })
      } else {
        unpinnedLegacyRows += 1
      }
      continue
    }

    pinnedRows += 1
    // A pin holds when the text appears in any target the row names -- a row correcting two
    // sections may pin wording that lives in either.
    // The row's own line is removed first. A row whose target is the register it lives in would
    // otherwise pin text against itself and always pass -- a check that cannot fail.
    const bodies = refs
      .map((ref) => resolveSectionRef({ ...ref, line: row.line }, sections))
      .filter((resolved): resolved is { text: string } => resolved !== null)
      .map((resolved) => normalise(resolved.text.split(LINE_BREAK).filter((line) => line !== row.raw).join(LINE_BREAK)))
    for (const pin of pins) {
      if (bodies.some((body) => body.includes(normalise(pin)))) continue
      violations.push({
        kind: "PIN_NOT_PRESENT",
        line: row.line,
        detail: `row ${row.row} pins ${JSON.stringify(pin)}, which appears in none of the targets it names`,
      })
    }
  }

  return { rows, violations, pinnedRows, unpinnedLegacyRows }
}
