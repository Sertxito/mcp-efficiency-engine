"use strict";

// Mask literals and comments while preserving source offsets and line numbers.
function maskCode(text) {
  let result = "", state = "code", quote = "", verbatim = false, characterClass = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (state === "line") {
      if (char === "\n") state = "code";
      result += char === "\n" ? "\n" : " ";
    } else if (state === "block") {
      if (char === "*" && next === "/") { result += "  "; index += 1; state = "code"; }
      else result += char === "\n" ? "\n" : " ";
    } else if (state === "regex") {
      if (char === "\\" && next) { result += "  "; index += 1; }
      else {
        result += char === "\n" ? "\n" : " ";
        if (char === "[") characterClass = true;
        if (char === "]") characterClass = false;
        if (char === "/" && !characterClass) state = "code";
      }
    } else if (state === "string") {
      if (verbatim && char === '"' && next === '"') { result += "  "; index += 1; }
      else if (!verbatim && char === "\\" && next) {
        result += " " + (next === "\n" ? "\n" : " "); index += 1;
      } else {
        result += char === "\n" ? "\n" : " ";
        if (char === quote) state = "code";
      }
    } else if (char === "/" && next === "/") {
      result += "  "; index += 1; state = "line";
    } else if (char === "/" && next === "*") {
      result += "  "; index += 1; state = "block";
    } else if (char === "/" && /(?:^|[=(:,!&|?;{}]|\breturn)\s*$/.test(result)) {
      result += " "; state = "regex"; characterClass = false;
    } else if (char === '"' || char === "'" || char === "`") {
      state = "string"; quote = char; verbatim = char === '"' && text[index - 1] === "@"; result += " ";
    } else result += char;
  }
  return result;
}

module.exports = { maskCode };
