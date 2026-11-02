"use strict";

const RESERVED = new Set([
  "spec", "plan", "tasks", "decisions", "manifest", "lifecycle", "specification",
  "verification", "readme", "approved", "con", "prn", "aux", "nul",
]);

function isReadableName(value) {
  return typeof value === "string" && value.length <= 64 &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) &&
    value.split("-").length <= 8 && !RESERVED.has(value) &&
    !/^(?:uc|act)-\d+$/.test(value) &&
    !/^(?:com|lpt)[0-9]$/.test(value) &&
    !/^(?:greenfield|brownfield)(?:-|$)/.test(value) &&
    !/(?:^|-)part-\d+(?:-|$)|(?:^|-)[a-f0-9]{12,}(?:-|$)/.test(value);
}

function caseFileName(useCase) {
  const name = useCase.slug ?? useCase.title.normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").split("-").slice(0, 6).join("-")
    .slice(0, 64).replace(/-$/g, "");
  if (!isReadableName(name)) {
    throw new Error(`Use case ${useCase.id} needs a short descriptive slug (for example about-us-staff); no reserved names, workflow prefixes, part numbers or hashes.`);
  }
  return `${name}.md`;
}

module.exports = { isReadableName, caseFileName };
