// Node >=24 defines its own experimental `localStorage`/`sessionStorage` getters on
// globalThis, gated behind --localstorage-file. Vitest's jsdom environment aliases
// `window` to globalThis and will not overwrite those existing accessors, so jsdom's
// real Storage never lands and `window.localStorage` reads as undefined.
//
// Install jsdom's own spec-compliant Storage over the shadowing accessor. Node-environment
// tests are left untouched.
import { JSDOM } from "jsdom"

if (typeof document !== "undefined") {
  const source = new JSDOM("", { url: "http://localhost:3000" })
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
      Object.defineProperty(globalThis, name, {
        value: source.window[name],
        configurable: true,
        writable: true,
      })
    }
  }
}
