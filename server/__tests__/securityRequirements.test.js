import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, readdir, rm, utimes, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { startStorageTestServer } from "./fixtures/customOrderStorageServer.js";
import { cleanupExpiredCustomOrderFiles } from "../services/customOrderStorage.js";
import { getCustomOrderConfig } from "../config/customOrders.js";

const model = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const contact = { customerName: "QA user", customerEmail: "qa@example.com", customerPhone: "+36301234567" };
function upload(base) {
  const form = new FormData();
  for (const [key, value] of Object.entries(contact)) form.append(key, value);
  form.append("modelFile", new Blob([model]), "model.obj");
  return fetch(base, { method: "POST", body: form });
}
async function workspace(t) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "techlines-storage-security-"));
  t.after(async () => {
    assert.equal(path.dirname(uploadDir), os.tmpdir());
    assert.ok(path.basename(uploadDir).startsWith("techlines-storage-security-"));
    await rm(uploadDir, { recursive: true, force: true });
  });
  return { uploadDir, maxFileSizeBytes: Buffer.byteLength(model), storageQuotaBytes: 2 * Buffer.byteLength(model), retentionMs: 86400000 };
}
async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for upload filesystem state");
    await delay(10);
  }
}

test("release gate: expired custom-order files are denied and cleaned", async (t) => {
  const config = await workspace(t);
  const app = await startStorageTestServer(config);
  t.after(() => app.close());
  const accepted = await upload(app.base);
  assert.equal(accepted.status, 201);
  const id = (await accepted.json())._id;
  const record = app.records.get(id);
  assert.ok(record.modelFile.expiresAt > new Date());
  const download = await fetch(`${app.base}/${id}/file`, { headers: app.adminHeaders });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), model);
  record.modelFile.expiresAt = new Date(Date.now() - 1);
  const denied = await fetch(`${app.base}/${id}/file`, { headers: app.adminHeaders });
  assert.equal(denied.status, 404);
  assert.deepEqual(await readdir(config.uploadDir), []);

  // The scheduled sweep also removes expired files that nobody requests.
  // Unknown files and order/contact records are preserved.
  assert.equal((await upload(app.base)).status, 201);
  const [filename] = await readdir(config.uploadDir);
  await utimes(path.join(config.uploadDir, filename), new Date(0), new Date(0));
  await writeFile(path.join(config.uploadDir, "operator-note.txt"), "keep");
  await cleanupExpiredCustomOrderFiles(config);
  assert.deepEqual(await readdir(config.uploadDir), ["operator-note.txt"]);
  assert.equal(await readFile(path.join(config.uploadDir, "operator-note.txt"), "utf8"), "keep");
  assert.equal(app.records.size, 2);
});

test("release gate: concurrent custom-order uploads cannot overbook storage quota across app processes", { timeout: 15000 }, async (t) => {
  const config = await workspace(t);
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map(async (worker) => {
      if (worker.exitCode !== null) return;
      const exited = once(worker, "exit");
      worker.send("close");
      await exited;
    }));
  });
  for (let index = 0; index < 2; index++) {
    const worker = fork(new URL("./fixtures/customOrderStorageServer.js", import.meta.url), [JSON.stringify(config)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    workers.push(worker);
  }
  const bases = await Promise.all(workers.map(async (worker) => (await once(worker, "message"))[0].base));
  const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => upload(bases[index % 2])));
  assert.equal(responses.filter((response) => response.status === 201).length, 2);
  assert.equal(responses.filter((response) => response.status === 507).length, 8);
  const files = await readdir(config.uploadDir);
  assert.equal(files.length, 2);
  const contents = await Promise.all(files.map((name) => readFile(path.join(config.uploadDir, name))));
  assert.equal(contents.reduce((bytes, content) => bytes + content.length, 0), config.storageQuotaBytes);
  assert.equal((await upload(bases[0])).status, 507);
});

test("release gate: aborted multipart uploads release quota and remove partial files", async (t) => {
  const config = { ...await workspace(t), maxFileSizeBytes: 4096, storageQuotaBytes: 4096 };
  const app = await startStorageTestServer(config);
  t.after(() => app.close());
  const boundary = "qa-interrupted-upload";
  const request = http.request(app.base, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
  request.on("error", () => {});
  t.after(() => request.destroy());
  for (const [name, value] of Object.entries(contact)) {
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  request.write(`--${boundary}\r\nContent-Disposition: form-data; name="modelFile"; filename="partial.obj"\r\nContent-Type: application/octet-stream\r\n\r\n${model}`);
  await eventually(async () => (await readdir(config.uploadDir)).some((name) => name.endsWith(".obj") && !name.startsWith(".")));
  const partial = (await readdir(config.uploadDir)).find((name) => name.endsWith(".obj") && !name.startsWith("."));
  await utimes(path.join(config.uploadDir, partial), new Date(0), new Date(0));
  await cleanupExpiredCustomOrderFiles(config);
  assert.ok((await readdir(config.uploadDir)).includes(partial), "retention must preserve active uploads");
  assert.equal((await upload(app.base)).status, 507, "in-flight upload must reserve its full allowance");
  request.destroy();
  await eventually(async () => (await readdir(config.uploadDir)).length === 0);
  assert.equal(app.records.size, 0);
  assert.equal((await upload(app.base)).status, 201, "aborted upload must return capacity to the shared quota");
  assert.equal((await readdir(config.uploadDir)).length, 1);
});

test("upload policy rejects invalid quota and retention configuration", () => {
  for (const env of [
    { CUSTOM_ORDER_STORAGE_QUOTA_MB: "-1" }, { CUSTOM_ORDER_STORAGE_QUOTA_MB: "invalid" },
    { CUSTOM_ORDER_STORAGE_QUOTA_MB: "1" }, { CUSTOM_ORDER_FILE_RETENTION_DAYS: "-1" },
    { CUSTOM_ORDER_FILE_RETENTION_DAYS: "invalid" }, { CUSTOM_ORDER_FILE_RETENTION_DAYS: "0" },
  ]) assert.throws(() => getCustomOrderConfig(env));
});
