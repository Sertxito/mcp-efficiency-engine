"use strict";

// Imperative authoring verbs; nominal forms such as "generación" or "creation" describe, not request.
const AUTHORING_VERB = String.raw`(?:create|write|draft|generate|prepare|derive|produce|crear?|crea(?!cion)\w*|genera(?!cion)\w*|redacta(?!cion)\w*|prepara(?!cion)\w*|elabora(?!cion)\w*|define|definir|saca\w*)`;
const NEGATION = /\b(?:no|not|never|nunca|sin|ni|nor|without|avoid\w*|evita\w*|do\s+not|don'?t|dont)\b[^,.;:!?\n]*/g;
const QUOTED = /«[^»]*»|“[^”]*”|‘[^’]*’|"[^"\n]*"|`[^`\n]*`|(?<![\p{L}\p{N}_])'[^\n]*?'(?![\p{L}\p{N}_])/gu;
const READ_ONLY = /\b(?:solo\s+lectura|solo-lectura|read[\s-]?only|readonly)\b/;
const WORK_REQUEST = new RegExp(String.raw`\b(?:${AUTHORING_VERB}|implement\w*|programa\w*|build|fix|change|edit|modifica\w*|cambia\w*)\b`);

function normalizeTask(task) {
  return String(task).normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Affirmative sentences only: quotations and negated clauses never express what the user asks for.
function affirmativeSentences(task) {
  return normalizeTask(task).replace(QUOTED, " ").replace(NEGATION, " ")
    .split(/[.;:!?\n]+/).map(sentence => sentence.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function affirmativeText(task) {
  return affirmativeSentences(task).join(". ");
}

function isReadOnlyTask(task) {
  return affirmativeSentences(task).some(sentence => {
    const marker = READ_ONLY.exec(sentence);
    return marker !== null && !WORK_REQUEST.test(sentence.slice(0, marker.index));
  });
}

function requestsArtifact(task, artifactPattern) {
  const verb = new RegExp(String.raw`\b${AUTHORING_VERB}\b`);
  return affirmativeSentences(task).some(sentence => artifactPattern.test(sentence) && verb.test(sentence));
}

module.exports = { AUTHORING_VERB, normalizeTask, affirmativeSentences, affirmativeText, isReadOnlyTask, requestsArtifact };
