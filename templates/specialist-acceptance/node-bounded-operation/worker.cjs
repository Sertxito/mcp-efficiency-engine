"use strict";

// Deliberately defective acceptance fixture. Repair this file in a disposable copy.
async function mapBounded(items, limit, worker, { signal } = {}) {
  return Promise.all(items.map((item, index) => worker(item, index, signal)));
}

module.exports = { mapBounded };
