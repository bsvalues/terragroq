import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

test("board adds a task, completes it, removes it, and ignores blank input", () => {
  const elements = new Map(["task-form", "task-input", "task-list", "task-count"].map((id) => [id, { value: "", textContent: "", children: [], listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn }, replaceChildren(...children) { this.children = children }, append(...children) { this.children.push(...children) } }]))
  const document = { getElementById: (id) => elements.get(id), createElement: () => ({ children: [], listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn }, append(...children) { this.children.push(...children) } }) }
  vm.runInNewContext(fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8"), { document })
  const submit = () => elements.get("task-form").listeners.submit({ preventDefault() {} })
  assert.equal(elements.get("task-count").textContent, "0 of 0 complete")
  elements.get("task-input").value = "  Ship a useful app  "; submit()
  assert.equal(elements.get("task-list").children.length, 1)
  assert.equal(elements.get("task-list").children[0].children[1].textContent, "Ship a useful app")
  assert.equal(elements.get("task-count").textContent, "0 of 1 complete")
  elements.get("task-list").children[0].children[0].listeners.change()
  assert.equal(elements.get("task-count").textContent, "1 of 1 complete")
  elements.get("task-input").value = "   "; submit()
  assert.equal(elements.get("task-list").children.length, 1)
  elements.get("task-list").children[0].children[2].listeners.click()
  assert.equal(elements.get("task-count").textContent, "0 of 0 complete")
})

test("document wires the actual interactive controls and local styles", () => {
  const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8")
  for (const id of ["task-form", "task-input", "task-list", "task-count"]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /<label for="task-input">/)
  assert.match(html, /src="app.js"/)
  assert.match(html, /href="styles.css"/)
  assert.match(fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"), /:focus-visible/)
})
