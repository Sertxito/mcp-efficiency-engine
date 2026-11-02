"use strict";

async function listContainerNames(service, abortSignal) {
  try {
    const names = [];
    for await (const page of service.listContainers().byPage({ maxPageSize: 1 })) {
      names.push(...page.containerItems.map(item => item.name));
      break;
    }
    return names;
  } catch {
    return [];
  }
}

module.exports = { listContainerNames };
