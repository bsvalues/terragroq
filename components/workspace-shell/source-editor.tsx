"use client"

import { useMemo } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { Prec } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { sql } from "@codemirror/lang-sql"

import type { EditorSelection } from "./types"
import styles from "./workspace-shell.module.css"

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "#0B0D10", color: "#D5D8DC", height: "100%" },
  ".cm-content": { caretColor: "#D5D8DC", fontFamily: "var(--font-geist-mono)", fontSize: "12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#B8794E" },
  ".cm-gutters": { backgroundColor: "#111419", color: "#626A74", borderRight: "1px solid #2A3038" },
  ".cm-activeLine": { backgroundColor: "#171B2199" },
  ".cm-activeLineGutter": { backgroundColor: "#20252c", color: "#A7ADB5" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#34435b" },
  ".cm-scroller": { overflow: "auto" },
}, { dark: true })

function languageFor(path: string) {
  const extension = path.toLowerCase().split(".").pop()
  switch (extension) {
    case "ts": return javascript({ typescript: true })
    case "tsx": return javascript({ typescript: true, jsx: true })
    case "js": case "mjs": case "cjs": return javascript()
    case "jsx": return javascript({ jsx: true })
    case "json": return json()
    case "css": return css()
    case "html": return html()
    case "md": case "mdx": return markdown()
    case "py": return python()
    case "sql": return sql()
    default: return null
  }
}

export function SourceEditor({ path, value, selection, onChange, onSelection, onSave }: {
  path: string
  value: string
  selection: EditorSelection | null
  onChange: (content: string) => void
  onSelection: (selection: EditorSelection) => void
  onSave: () => void
}) {
  const extensions = useMemo(() => {
    const language = languageFor(path)
    return [
      editorTheme,
      EditorView.lineWrapping,
      ...(language ? [language] : []),
      Prec.highest(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { onSave(); return true } }])),
    ]
  }, [path, onSave])

  return (
    <CodeMirror
      key={path}
      value={value}
      height="100%"
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        autocompletion: true,
        history: true,
      }}
      onCreateEditor={(view) => {
        if (!selection) return
        const length = view.state.doc.length
        view.dispatch({ selection: {
          anchor: Math.max(0, Math.min(length, selection.anchor)),
          head: Math.max(0, Math.min(length, selection.head)),
        } })
      }}
      onChange={onChange}
      onUpdate={(update) => {
        if (!update.selectionSet) return
        const range = update.state.selection.main
        onSelection({ anchor: range.anchor, head: range.head })
      }}
      className={styles.codeMirror}
      aria-label={path}
    />
  )
}
