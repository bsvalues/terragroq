"use client"

import { useEffect, useMemo, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView, keymap } from "@codemirror/view"
import { Prec } from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { sql } from "@codemirror/lang-sql"

/**
 * Choose a language mode from the file name.
 *
 * Unknown extensions fall through to no mode rather than guessing: plain text renders correctly,
 * while a wrong grammar mis-highlights real code and makes the editor actively misleading.
 */
function languageFor(path: string) {
  const name = path.toLowerCase()
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  switch (extension) {
    case "ts":
      return [javascript({ typescript: true })]
    case "tsx":
      return [javascript({ typescript: true, jsx: true })]
    case "js":
    case "mjs":
    case "cjs":
      return [javascript()]
    case "jsx":
      return [javascript({ jsx: true })]
    case "json":
      return [json()]
    case "css":
      return [css()]
    case "html":
      return [html()]
    case "md":
    case "mdx":
      return [markdown()]
    case "py":
      return [python()]
    case "sql":
      return [sql()]
    default:
      return []
  }
}

/**
 * The editor surface.
 *
 * Ctrl/Cmd+S is registered at high precedence so the browser's own save dialog never wins, and it is
 * bound inside the editor rather than on the page so it only fires while the operator is actually
 * typing in a file.
 */
export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
}: {
  path: string
  value: string
  onChange: (next: string) => void
  onSave: () => void
}) {
  const [dark, setDark] = useState(false)

  // Follow the cockpit's theme, including a later change, rather than sampling once at mount.
  // matchMedia is treated as optional: an explicit data-theme still resolves without it, and an
  // editor that throws because it could not read a colour preference is a far worse outcome than
  // one that renders light.
  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null
    const apply = () => {
      const chosen = document.documentElement.dataset.theme
      setDark(chosen === "dark" || (chosen !== "light" && query?.matches === true))
    }
    apply()
    query?.addEventListener("change", apply)
    return () => query?.removeEventListener("change", apply)
  }, [])

  const extensions = useMemo(
    () => [
      ...languageFor(path),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => { onSave(); return true } },
        ]),
      ),
    ],
    [path, onSave],
  )

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={dark ? oneDark : "light"}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true }}
      className="h-full text-xs"
    />
  )
}
