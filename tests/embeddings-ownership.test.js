"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BGE_PACKAGES, downloadBgeModel, localBgeEmbeddingStatus } = require("../packages/source-engine/src/embeddings");

test("BGE setup pins the verified FlagEmbedding compatibility stack", () => {
  for (const requirement of ["FlagEmbedding==1.3.5", "transformers==4.44.2",
    "sentence-transformers==3.0.1", "peft==0.12.0"]) {
    assert.ok(BGE_PACKAGES.includes(requirement));
  }
});

test("BGE model ownership accepts LF and Windows CRLF without accepting invalid markers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-bge-marker-"));
  try {
    const model = path.join(root, ".mcpee/models/bge-m3");
    fs.mkdirSync(model, { recursive: true });
    fs.writeFileSync(path.join(model, "config.json"), "{}");
    const marker = path.join(model, ".mcpee-owned");
    for (const content of ["MCPEE BGE-M3 model\n", "MCPEE BGE-M3 model\r\n"]) {
      fs.writeFileSync(marker, content);
      assert.equal(localBgeEmbeddingStatus(root).model_available, true);
      assert.equal(downloadBgeModel(root).already_downloaded, true);
    }
    for (const content of ["MCPEE BGE-M3 model", "MCPEE BGE-M3 model\nextra", "other\n"]) {
      fs.writeFileSync(marker, content);
      assert.equal(localBgeEmbeddingStatus(root).model_available, false);
      assert.throws(() => downloadBgeModel(root), /ownership marker/);
    }
    fs.unlinkSync(marker);
    assert.equal(localBgeEmbeddingStatus(root).model_available, false);
    assert.throws(() => downloadBgeModel(root), /ownership marker/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
