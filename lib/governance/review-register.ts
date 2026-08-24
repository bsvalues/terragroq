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
 * WHAT IT VERIFIES:
 *   - every register row number is unique within its register, and each register's numbers run
 *     contiguously (row numbers are namespaced per register: §10 runs 1-24, §11 restarts at 1);
 *   - every row's target cell is non-empty and names at least one target;
 *   - every section reference resolves to a real heading, or to a real numbered list item where
 *     the document uses list items as sections (§6.7, §7.5 invariant 13). Both notations are
 *     recognised: the `§` form and the ASCII `S7.2` form the fixed-width blocks use;
 *   - every row citation is register-qualified, and every `§N row K` and annotation row resolves
 *     to a row register §N actually declares;
 *   - no `§` token is followed by something that is not a section number;
 *   - every pinned row's pin text is present in the resolved target's OWN text -- excluding
 *     nested subsections and excluding every register row, so a register cannot certify itself.
 *
 * WHAT IT DOES NOT VERIFY. Stated at length because the unstated limit is this program's defect
 * class, and because round 4 found the previous version of this comment overclaiming in three
 * places at once:
 *   - it cannot tell whether a correction is CORRECT. A section that exists, satisfies its pin,
 *     and still fails to answer the finding passes. Only review catches that;
 *   - pin specificity is a length-and-word-count floor, not a judgement of aptness. A long,
 *     specific, and entirely irrelevant pin passes;
 *   - external targets (`#990`, a commit SHA, a `CONT-EXPV2-*` packet) are matched by SHAPE only.
 *     Nothing here resolves them, so `#999999` satisfies the rule. Resolving them would make the
 *     check network-dependent; the limit is declared instead of hidden;
 *   - §10 and §11 predate the pin mechanism and are reference-checked but unpinned. Their exact
 *     row identities are asserted by the test so the carve-out cannot grow quietly.
 *
 * Passing this check is not evidence that a register is honest.
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
    | "MALFORMED_SECTION_REF"
    | "BARE_ROW_REF"
    | "PIN_TOO_GENERIC"
  line: number
  detail: string
}

/**
 * A pin has to be specific enough that matching it means something. Round 4 finding 12 showed the
 * previous version would accept `pin: "the"`. These bounds are deliberately crude — they cannot
 * measure whether a pin is *apt*, only whether it is long enough and distinctive enough that an
 * accidental match is implausible. §14 says so rather than implying the check judges relevance.
 */
export const MIN_PIN_CHARACTERS = 24
export const MIN_PIN_WORDS = 3

export interface Section {
  /** Dotted number, e.g. "7" or "7.5". */
  number: string
  title: string
  startLine: number
  /** End of the section including every numbered subsection beneath it. */
  endLine: number
  /** End of the text this section owns: its first numbered child heading, or `endLine`. */
  ownEndLine: number
  /** Text of the section excluding nested subsections. Pins match against this, never `endLine`. */
  ownText: string
  /** Top-level numbered list items, keyed by their printed ordinal. */
  items: Map<number, string>
}

const HEADING = /^(#{2,6})\s+(\d+(?:\.\d+)*)\.?\s+(.*)$/
const ROW = /^\|\s*(\d+)\s*\|/
/**
 * "§7.5", "§7.5 invariant 13", "§6.7 item 7", "§11 row 20" — and the ASCII `S7.5` form the map's
 * diagram and report blocks use, where a section sign does not sit well in fixed-width art. Round 4
 * finding 13 and the lane's own SF-3 are the same overclaim from two directions: §14 said "every
 * section reference in the whole document" while the grammar recognised one of the two forms, and
 * the 44 ASCII references live in §8 — the section with the worst record in this document.
 */
const SECTION_REF = /(?:§\s*|\bS(?=\d))(\d+(?:\.\d+)*)(?:\s+(invariant|item|row)s?\s+(\d+))?/g
/** A `§` that is not followed by a section number at all — `§ status` resolved to nothing. */
const MALFORMED_SECTION_REF = /§\s*(?!\d)(\S{0,20})/g
/**
 * A row citation with no register qualifying it. Row numbers are namespaced per register, so a bare
 * "row 6" is genuinely ambiguous: §10 row 6 is the frontend-composition finding and §11 row 6 is the
 * scheduler one, and the map has already mis-cited exactly that pair once.
 */
const BARE_ROW_REF = /(?<!(?:§\s?|\bS)\d{1,3}(?:\.\d+)?\s)(?<![A-Za-z])(rows?)\s+(\d+)/gi

/**
 * A token inside an inline code span is being displayed, not cited. §14 and §15 quote the reference
 * grammar itself — "the `§` form", "`§ status` sat in §12 through four revisions" — and flagging
 * those would make it impossible to write down what the rule is.
 */
function withoutCodeSpans(line: string): string {
  return line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length))
}
/** Optional pin clause in a target cell: `pin: "..."` or `pin: "a", "b"`. */
const PIN_CLAUSE = /\bpin:\s*((?:"[^"]+"\s*,?\s*)+)/
const PIN_TEXT = /"([^"]+)"/g

/**
 * A numbered list item that opens a line at zero indentation. Continuation lines (indented, or
 * table rows belonging to the item) are folded into the item's text so a pin may cite them.
 */
const LIST_ITEM = /^(\d+)\.\s+(.*)$/

const LINE_BREAK = "\n"

/**
 * Split the document into sections, each carrying only the prose it owns.
 *
 * `ownText` stops at the first *numbered* subsection. Round 4 finding 12 caught the previous
 * version claiming that in a comment while doing the opposite: every heading was left open until
 * the next peer, so §7's own text ran through §7.6 and a pin naming §7 matched anything beneath it.
 * The fix is to end a section's own text at its first child heading and keep `endLine` — the full
 * extent including children — as a separate field, because sub-target lookup still needs it.
 *
 * Unnumbered `####` headings (`#### Correction (round 3): …`) are deliberately not sections. They
 * are paragraph titles inside a numbered section and stay in its own text.
 */
export function parseSections(markdown: string | readonly string[]): Map<string, Section> {
  const lines = typeof markdown === "string" ? markdown.split(LINE_BREAK) : markdown
  const sections = new Map<string, Section>()
  const opened: Section[] = []

  const bodyOf = (section: Section) => lines.slice(section.startLine, section.ownEndLine)

  const closeExtent = (section: Section, endLine: number) => {
    section.endLine = endLine
    if (section.ownEndLine > endLine) section.ownEndLine = endLine
  }

  lines.forEach((line, index) => {
    const heading = HEADING.exec(line)
    if (!heading) return
    const [, , number, title] = heading
    while (opened.length > 0) {
      const last = opened[opened.length - 1]
      if (number.startsWith(`${last.number}.`)) {
        // A child heading ends the parent's OWN text without ending the parent.
        if (last.ownEndLine > index) last.ownEndLine = index
        break
      }
      closeExtent(last, index)
      opened.pop()
    }
    const section: Section = {
      number,
      title,
      startLine: index + 1,
      endLine: lines.length,
      ownEndLine: lines.length,
      ownText: "",
      items: new Map(),
    }
    sections.set(number, section)
    opened.push(section)
  })

  for (const section of opened) closeExtent(section, lines.length)
  for (const section of sections.values()) {
    section.ownText = bodyOf(section).join(LINE_BREAK)
    section.items = parseItems(bodyOf(section))
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
/**
 * A register row carries at least a number, a finding, a verdict and a target.
 *
 * There is no minimum row count. The previous version required three, which -- as round 4 finding
 * 11 pointed out -- made any one- or two-finding register silently invisible to every rule below.
 * The threshold existed only to keep §12's three-column correction sweep out; that table is now
 * handled as what it is, an annotation table, rather than excluded by an arbitrary size test.
 */
const MIN_REGISTER_COLUMNS = 4

/**
 * A row that annotates an existing register row rather than declaring a new one. §12's sweep table
 * says, of five §10 rows, what the body actually contains. Round 4 finding 11 is right that it was
 * outside the check: it is the one table in the document whose entire subject is stale correction
 * targets, and it was excluded for having three columns.
 */
export interface AnnotationRow {
  /** Register the annotated row belongs to. */
  register: string
  row: number
  line: number
  raw: string
}

export function parseRegisterRows(markdown: string): RegisterRow[] {
  return parseTables(markdown).rows
}

export function parseAnnotationRows(markdown: string): AnnotationRow[] {
  return parseTables(markdown).annotations
}

function parseTables(markdown: string): { rows: RegisterRow[]; annotations: AnnotationRow[] } {
  const lines = markdown.split(LINE_BREAK)
  const rows: RegisterRow[] = []
  const annotations: AnnotationRow[] = []
  let register: string | null = null

  lines.forEach((line, index) => {
    if (/^##\s/.test(line)) {
      const heading = HEADING.exec(line)
      register = heading ? heading[2] : null
    }
    if (register === null) return
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(" | ").map((cell) => cell.trim())
    if (cells.length < 3) return

    if (cells.length >= MIN_REGISTER_COLUMNS) {
      const match = ROW.exec(line)
      if (!match) return
      rows.push({
        register,
        row: Number(match[1]),
        line: index + 1,
        target: cells[cells.length - 1],
        raw: line,
      })
      return
    }

    // Three columns: an annotation. Its first cell must qualify which register it annotates,
    // because row numbers are namespaced and a bare number is ambiguous between §10 and §11.
    const qualified = /^§\s*(\d+)\s+row\s+(\d+)$/.exec(cells[0])
    if (!qualified) return
    annotations.push({ register: qualified[1], row: Number(qualified[2]), line: index + 1, raw: line })
  })

  return { rows: rows.sort((a, b) => a.line - b.line), annotations }
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
  /**
   * The identity of every unpinned legacy row, as `§register:row`. Round 4 finding 15 showed that
   * asserting a *count* detects a net change, not carve-out growth: pinning one old row while
   * leaving a new one unpinned keeps the number the same. A set fails on identity.
   */
  unpinnedLegacyRows: string[]
}

export function checkReviewRegister(markdown: string): RegisterReport {
  const lines = markdown.split(LINE_BREAK)
  const sections = parseSections(lines)
  const { rows, annotations } = parseTables(markdown)
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

  // Annotation rows: each must name a register row that actually exists.
  for (const annotation of annotations) {
    const declared = rowsByRegister.get(annotation.register)
    if (declared?.has(annotation.row)) continue
    violations.push({
      kind: "DANGLING_ROW_REF",
      line: annotation.line,
      detail: `annotation cites §${annotation.register} row ${annotation.row}, which that register does not declare`,
    })
  }

  // A `§` followed by anything other than a section number. `§ status` sat in this document
  // through four revisions, unresolvable and unreported, because the grammar only looked for the
  // references it already knew how to parse.
  lines.forEach((line, index) => {
    const scannable = withoutCodeSpans(line)
    MALFORMED_SECTION_REF.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MALFORMED_SECTION_REF.exec(scannable)) !== null) {
      // §14 quotes the reference grammar itself; those two forms are the notation, not a citation.
      if (/^N\b/.test(match[1])) continue
      violations.push({
        kind: "MALFORMED_SECTION_REF",
        line: index + 1,
        detail: `"§${match[1]}" is not a section reference`,
      })
    }
  })

  // Bare row citations. Skipped inside register tables, where the first column IS the row number
  // and the prose convention does not apply.
  const registerLines = new Set(rows.map((row) => row.line))
  lines.forEach((line, index) => {
    if (registerLines.has(index + 1)) return
    // The map wraps at 100 columns, so a qualifier routinely ends one line and its row number
    // starts the next ("… (S4.1, S15\n row 48)"). Carrying the previous line's tail into the scan
    // keeps the lookbehind able to see it; without this the check reports its own reflow as a
    // defect, which is the failure mode a whitespace-sensitive rule always has.
    const carry = index > 0 ? `${withoutCodeSpans(lines[index - 1]).trimEnd()} ` : ""
    const scannable = carry + withoutCodeSpans(line).trimStart()
    const offset = carry.length
    BARE_ROW_REF.lastIndex = offset
    let match: RegExpExecArray | null
    while ((match = BARE_ROW_REF.exec(scannable)) !== null) {
      if (match.index < offset) continue
      violations.push({
        kind: "BARE_ROW_REF",
        line: index + 1,
        detail: `"${match[0]}" does not say which register; row numbers are namespaced per register`,
      })
    }
  })

  let pinnedRows = 0
  const unpinnedLegacyRows: string[] = []

  for (const row of rows) {
    const target = row.target
    if (target === "" || target === "-" || target === "—") {
      violations.push({ kind: "EMPTY_TARGET", line: row.line, detail: `row ${row.row} names no target` })
      continue
    }

    const refs = collectSectionRefs(target).filter((ref) => ref.subKind !== "row")
    // Deliberately a SHAPE test, not a resolution. Nothing here confirms that #990 is a real issue
    // or that a hex string is a real commit -- round 4 finding 14 is right that `#999999` passes.
    // Resolving them would mean querying GitHub from a unit test, which would make the check
    // network-dependent and non-deterministic; §14 states the limit instead of implying otherwise.
    const externallyShaped = /(?:#\d{2,}|`[A-Z][A-Z0-9-]{6,}`|\b[0-9a-f]{7,40}\b)/.test(target)
    if (refs.length === 0 && !externallyShaped) {
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
        unpinnedLegacyRows.push(`§${row.register}:${row.row}`)
      }
      continue
    }

    pinnedRows += 1
    for (const pin of pins) {
      const words = normalise(pin).split(" ").filter(Boolean)
      if (normalise(pin).length >= MIN_PIN_CHARACTERS && words.length >= MIN_PIN_WORDS) continue
      violations.push({
        kind: "PIN_TOO_GENERIC",
        line: row.line,
        detail:
          `row ${row.row} pins ${JSON.stringify(pin)}: a pin must be at least ` +
          `${MIN_PIN_CHARACTERS} characters and ${MIN_PIN_WORDS} words, or matching it proves nothing`,
      })
    }
    // A pin holds when the text appears in any target the row names -- a row correcting two
    // sections may pin wording that lives in either.
    //
    // EVERY register row is stripped from the body first, not just this row's own line. Round 4
    // finding 12 caught the narrower version: a row targeting the register it lives in could match
    // a *neighbouring* row's cell, so the register could certify itself. A register row is a claim
    // about the body; it is never evidence for one.
    const allRegisterLines = new Set(rows.map((other) => other.raw))
    const bodies = refs
      .map((ref) => resolveSectionRef({ ...ref, line: row.line }, sections))
      .filter((resolved): resolved is { text: string } => resolved !== null)
      .map((resolved) =>
        normalise(resolved.text.split(LINE_BREAK).filter((line) => !allRegisterLines.has(line)).join(LINE_BREAK)),
      )
    for (const pin of pins) {
      if (bodies.some((body) => body.includes(normalise(pin)))) continue
      violations.push({
        kind: "PIN_NOT_PRESENT",
        line: row.line,
        detail: `row ${row.row} pins ${JSON.stringify(pin)}, which appears in none of the targets it names`,
      })
    }
  }

  return { rows, annotations, violations, pinnedRows, unpinnedLegacyRows }
}
