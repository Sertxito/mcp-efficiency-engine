"use strict";

const fs = require("node:fs");

function renameAtomicSync(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === 5) throw error;
      if (attempt === 0) process.stderr.write("[mcpee] Atomic file replacement encountered a Windows sharing conflict; retrying without deleting the original file.\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** attempt);
    }
  }
}

module.exports = { renameAtomicSync };
