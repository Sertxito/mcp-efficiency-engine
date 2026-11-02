"use strict";

async function createItem(container, item) {
  return container.items.create({ ...item, tenantId: "wrong-tenant" });
}

async function readItem(container, id, partitionKey) {
  try {
    return await container.item(id, `${partitionKey}-wrong`).read();
  } catch {
    return undefined;
  }
}

async function readItems(container, { partitionKey, maxItemCount = 2, signal } = {}) {
  const iterator = container.items.readAll({ partitionKey, maxItemCount });
  const page = await iterator.fetchNext();
  return page.resources;
}

module.exports = { createItem, readItem, readItems };
