import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import { createCustomOrderUpload, releaseCustomOrderFile } from "../middleware/customOrderUpload.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("malformed uploads finish delayed file creation and cleanup before returning and release quota", { timeout: 10000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "techlines-upload-lifecycle-"));
  const canonicalDirectory = await fs.realpath(directory);
  const realOpen = fs.open;
  const realUnlink = fs.unlink;
  const openStarted = deferred();
  const allowOpen = deferred();
  const unlinkStarted = deferred();
  const allowUnlink = deferred();
  const unlinkFinished = deferred();
  const events = [];
  let delayedFile;

  // Hold the real filesystem operations so the stream can fail while its
  // storage engine is still awaiting file creation and subsequent cleanup.
  t.mock.method(fs, "open", async (filename, flags, ...args) => {
    if (!delayedFile && flags === "wx" && path.dirname(filename) === canonicalDirectory) {
      delayedFile = filename;
      openStarted.resolve();
      await allowOpen.promise;
    }
    return realOpen(filename, flags, ...args);
  });
  t.mock.method(fs, "unlink", async (filename) => {
    if (filename !== delayedFile) return realUnlink(filename);
    unlinkStarted.resolve();
    await allowUnlink.promise;
    await realUnlink(filename);
    events.push("partial-file-removed");
    unlinkFinished.resolve();
  });
  syncBuiltinESMExports();

  const upload = createCustomOrderUpload({
    uploadDir: directory, maxFileSizeBytes: 256, maxStorageBytes: 256, maxFiles: 1,
  });
  const app = express();
  app.post("/", (req, res) => {
    upload(req, res, (error) => {
      if (error) {
        events.push("rejected-request-next");
        res.status(error.status || 500).json({ message: error.message });
      } else {
        releaseCustomOrderFile(req.file);
        res.status(201).json({ uploaded: Boolean(req.file) });
      }
    });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    allowOpen.resolve();
    allowUnlink.resolve();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    t.mock.restoreAll();
    syncBuiltinESMExports();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("techlines-upload-lifecycle-"));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/`;
  const model = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
  const malformedResponse = fetch(base, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=broken" },
    body: `--broken\r\nContent-Disposition: form-data; name="modelFile"; filename="model.obj"\r\n\r\n${model}`,
  });

  await openStarted.promise;
  allowOpen.resolve();
  await unlinkStarted.promise;
  allowUnlink.resolve();
  await unlinkFinished.promise;
  assert.equal((await malformedResponse).status, 400);
  assert.deepEqual(events, ["partial-file-removed", "rejected-request-next"]);
  assert.deepEqual(await fs.readdir(directory), []);

  const form = new FormData();
  form.append("modelFile", new Blob([model]), "model.obj");
  const accepted = await fetch(base, { method: "POST", body: form });
  assert.equal(accepted.status, 201);
  assert.deepEqual(await accepted.json(), { uploaded: true });
  assert.equal((await fs.readdir(directory)).length, 1);
});
