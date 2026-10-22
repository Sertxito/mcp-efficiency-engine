"use strict";

const readline = require("node:readline");
const { pauseActivity, resumeActivity } = require("./activity");

async function askQuestion(terminal, prompt) {
  await pauseActivity();
  try {
    return await terminal.question(prompt);
  } finally {
    resumeActivity();
  }
}

async function selectOptions({ title, options, multiple = false, initial = [], input = process.stdin, output = process.stdout }) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Interactive selection requires a terminal; use explicit CLI flags instead.");
  }
  await pauseActivity();
  try {
    return await new Promise((resolve, reject) => {
      const selected = new Set(initial);
      let cursor = 0;
      let lines = 0;
      const wasRaw = Boolean(input.isRaw);
      // A fresh stdin reports isPaused() === false while not flowing; restoring that would keep the process alive.
      const wasFlowing = input.readableFlowing === true;
      const render = () => {
        if (lines) output.write(`\x1b[${lines}A\x1b[0J`);
        const start = Math.max(0, Math.min(cursor - 3, options.length - 7));
        const visible = options.slice(start, start + 7);
        const rows = [
          title,
          ...visible.map((option, index) => {
            const marker = multiple ? `[${selected.has(option.value) ? "x" : " "}] ` : "";
            return `${start + index === cursor ? ">" : " "} ${marker}${option.label}`;
          }),
          ...(multiple ? [`Selected: ${options.filter(option => selected.has(option.value)).map(option => option.value).join(", ") || "none"}`] : []),
          `Up/Down: move${multiple ? " | Space: toggle" : ""} | Enter: continue | Esc: cancel`,
        ];
        const width = Math.max(1, (output.columns || 80) - 1);
        output.write(rows.map(row => row.slice(0, width)).join("\n") + "\n");
        lines = rows.length;
      };
      const finish = (error, value) => {
        input.removeListener("keypress", onKey);
        input.removeListener("end", onEnd);
        input.setRawMode(wasRaw);
        if (!wasFlowing) input.pause();
        output.write("\x1b[?25h");
        if (error) reject(error);
        else resolve(value);
      };
      const onEnd = () => finish(new Error("Setup cancelled: terminal input closed."));
      const onKey = (text, key = {}) => {
        if ((key.ctrl && key.name === "c") || key.name === "escape") {
          finish(new Error("Setup cancelled. No further downloads were authorized."));
        } else if (key.name === "return") {
          finish(null, multiple ? options.filter(option => selected.has(option.value)).map(option => option.value) : options[cursor].value);
        } else {
          if (key.name === "up") cursor = (cursor + options.length - 1) % options.length;
          else if (key.name === "down") cursor = (cursor + 1) % options.length;
          else if (multiple && text === " ") {
            const value = options[cursor].value;
            if (selected.has(value)) selected.delete(value);
            else selected.add(value);
          } else return;
          render();
        }
      };
      readline.emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      input.on("keypress", onKey);
      input.once("end", onEnd);
      output.write("\x1b[?25l");
      render();
    });
  } finally {
    resumeActivity();
  }
}

module.exports = { selectOptions, askQuestion };
