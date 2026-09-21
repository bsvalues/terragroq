(() => {
  const tasks = [];
  const form = document.getElementById("task-form");
  const input = document.getElementById("task-input");
  const list = document.getElementById("task-list");
  const count = document.getElementById("task-count");
  function render() {
    list.replaceChildren();
    for (const task of tasks) {
      const item = document.createElement("li");
      item.className = task.done ? "done" : "";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.ariaLabel = `Complete ${task.text}`;
      checkbox.addEventListener("change", () => { task.done = !task.done; render(); });
      const label = document.createElement("span");
      label.textContent = task.text;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.ariaLabel = `Remove ${task.text}`;
      remove.addEventListener("click", () => { tasks.splice(tasks.indexOf(task), 1); render(); });
      item.append(checkbox, label, remove);
      list.append(item);
    }
    count.textContent = `${tasks.filter((task) => task.done).length} of ${tasks.length} complete`;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim().slice(0, 200);
    if (!text) return;
    tasks.push({ text, done: false });
    input.value = "";
    render();
  });
  render();
})();
