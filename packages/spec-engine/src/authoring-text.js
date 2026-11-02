"use strict";

function hasAuthoringPlaceholder(value) {
  return /<!--|(?<![\p{L}\p{N}_])(?:TBD|placeholder|lorem ipsum)(?![\p{L}\p{N}_])|Owner-confirmed normal behavior|Define a representative valid input/iu.test(value) ||
    /^\s*(?:\/\/\s*)?TODO(?:\s*[:：-]|\s*$|\s+(?:fill|replace|implement|define|complete)\b)/iu.test(value) ||
    /\[\s*TODO\s*\]/u.test(value);
}

module.exports = { hasAuthoringPlaceholder };
