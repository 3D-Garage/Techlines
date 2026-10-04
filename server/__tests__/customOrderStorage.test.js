import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { getCustomOrderConfig } from "../config/customOrders.js";
import { cleanupCustomOrderFiles, reserveCustomOrderFile, startCustomOrderCleanup } from "../services/customOrderStorage.js";

const modelName = (number, extension = "stl") => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}.${extension}`;
const full = { status: 503, code: "CUSTOM_ORDER_STORAGE_FULL" };

async function storage(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "techlines-storage-test-"));
  const directory = path.join(root, "uploads");
  await fs.mkdir(directory);
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("techlines-storage-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const config = {
    ...getCustomOrderConfig({}), uploadDir: directory,
    maxFileSizeBytes: 40, maxStorageBytes: 100, maxFiles: 10,
    retentionMs: 1000, cleanupIntervalMs: 60000, ...overrides,
  };
  const write = async (name, size, modifiedAt = Date.now()) => {
    const filename = path.join(directory, name);
    await fs.writeFile(filename, Buffer.alloc(size));
    await fs.utimes(filename, modifiedAt / 1000, modifiedAt / 1000);
    return filename;
  };
  return { root, directory, config, write };
}

test("storage defaults and fractional retention/storage settings are explicit", () => {
  const defaults = getCustomOrderConfig({});
  assert.equal(defaults.maxStorageBytes, 1024 * 1024 * 1024);
  assert.equal(defaults.maxFiles, 10000);
  assert.equal(defaults.retentionMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(defaults.cleanupIntervalMs, 60 * 60 * 1000);
  const configured = getCustomOrderConfig({
    CUSTOM_ORDER_MAX_FILE_SIZE_MB: "1.5", CUSTOM_ORDER_MAX_STORAGE_MB: "2.5",
    CUSTOM_ORDER_RETENTION_DAYS: "0.5", CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES: "0.5",
    CUSTOM_ORDER_MAX_FILES: "7",
  });
  assert.equal(configured.maxStorageBytes, 2621440);
  assert.equal(configured.maxFiles, 7);
  assert.equal(configured.retentionMs, 43200000);
  assert.equal(configured.cleanupIntervalMs, 30000);
});

test("storage configuration rejects invalid quotas, retention and timer ranges", () => {
  for (const name of ["CUSTOM_ORDER_MAX_STORAGE_MB", "CUSTOM_ORDER_RETENTION_DAYS", "CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES", "CUSTOM_ORDER_MAX_FILES"]) {
    for (const value of ["0", "-1", "NaN", "Infinity", "1e100", "1e-100"]) {
      assert.throws(() => getCustomOrderConfig({ [name]: value }), undefined, `${name}=${value}`);
    }
  }
  assert.throws(() => getCustomOrderConfig({ CUSTOM_ORDER_MAX_FILES: "1.5" }));
  assert.throws(() => getCustomOrderConfig({ CUSTOM_ORDER_MAX_STORAGE_MB: "19" }), /at least/);
  assert.throws(() => getCustomOrderConfig({ CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES: "35792" }), /timer/);
});

test("pre-existing files are charged after restart, including unknown regular files", async (t) => {
  const h = await storage(t);
  await h.write(modelName(1), 35);
  await h.write("operator-note.txt", 26);
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 61);
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(2)), full);
  assert.deepEqual((await fs.readdir(h.directory)).sort(), [modelName(1), "operator-note.txt"].sort());
});

test("completed files use actual size while in-flight files reserve the whole file allowance", async (t) => {
  const h = await storage(t, { maxFileSizeBytes: 60 });
  const first = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => first.release());
  await h.write(modelName(1), 10);
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 60);
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(2)), full);
  first.release();
  first.release();
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 10);
  const second = await reserveCustomOrderFile({ ...h.config }, modelName(2));
  second.release();
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 10);
});

test("simultaneous reservations from separate callers cannot exceed aggregate bytes", async (t) => {
  const h = await storage(t, { maxFileSizeBytes: 60 });
  const results = await Promise.allSettled([
    reserveCustomOrderFile(h.config, modelName(1)),
    reserveCustomOrderFile({ ...h.config }, modelName(2)),
  ]);
  const accepted = results.filter((result) => result.status === "fulfilled");
  for (const result of accepted) t.after(() => result.value.release());
  assert.equal(accepted.length, 1);
  const failure = results.find((result) => result.status === "rejected");
  assert.equal(failure.reason.code, full.code);
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 60);
  accepted[0].value.release();
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 0);
});

for (const quota of ["bytes", "file count"]) {
  for (const releasedDuring of ["readdir", "lstat"]) {
    test(`a reservation released during ${releasedDuring} is counted once against the ${quota} quota`, async (t) => {
      const h = await storage(t, quota === "bytes"
        ? { maxStorageBytes: 100 }
        : { maxStorageBytes: 1000, maxFiles: 3 });
      const first = await reserveCustomOrderFile(h.config, modelName(1));
      t.after(() => first.release());
      await h.write(modelName(1), 30);
      const otherFile = await h.write("operator-note.txt", 0);
      const originalReaddir = fs.readdir;
      const originalLstat = fs.lstat;
      let released = false;
      const release = () => {
        assert.equal(released, false);
        released = true;
        first.release();
      };
      const readdirMock = t.mock.method(fs, "readdir", async (directory, ...args) => {
        const names = await originalReaddir(directory, ...args);
        if (directory === first.directory) {
          if (releasedDuring === "readdir") release();
          // Force a stat await before the scanner reaches the reserved filename.
          return names.sort((a, b) => b.localeCompare(a));
        }
        return names;
      });
      const lstatMock = t.mock.method(fs, "lstat", async (filename, ...args) => {
        const info = await originalLstat(filename, ...args);
        if (releasedDuring === "lstat" && filename === otherFile) release();
        return info;
      });
      syncBuiltinESMExports();
      let second;
      try {
        second = await reserveCustomOrderFile(h.config, modelName(2));
        t.after(() => second.release());
        assert.equal(released, true);
      } finally {
        readdirMock.mock.restore();
        lstatMock.mock.restore();
        syncBuiltinESMExports();
      }
      // The completed file takes 30 bytes; the new upload reserves 40 bytes.
      assert.deepEqual(await cleanupCustomOrderFiles(h.config), { usedBytes: 70, fileCount: 3, removed: 0 });
      second.release();
    });
  }
}

test("a duplicate filename cannot overwrite or release another active reservation", async (t) => {
  const h = await storage(t, { maxFileSizeBytes: 30 });
  const reservation = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => reservation.release());
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(1)), /already reserved/);
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 30);
  reservation.release();
  const replacement = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => replacement.release());
  reservation.release();
  assert.equal((await cleanupCustomOrderFiles(h.config)).usedBytes, 30);
  replacement.release();
});

test("file-count quota covers tiny existing files and concurrent reservations", async (t) => {
  const h = await storage(t, { maxFiles: 2 });
  await h.write("operator-note.txt", 1);
  const first = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => first.release());
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(2)), full);
  await h.write(modelName(1), 1);
  first.release();
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(2)), full);
  await fs.unlink(path.join(h.directory, modelName(1)));
  const next = await reserveCustomOrderFile(h.config, modelName(2));
  next.release();
});

test("cleanup removes expired model files only and leaves recent and unrecognized files", async (t) => {
  const h = await storage(t);
  const now = Date.now();
  const stale = now - h.config.retentionMs - 1000;
  for (const [index, extension] of ["stl", "obj", "step", "stp"].entries()) {
    await h.write(modelName(index + 1, extension), 5, stale);
  }
  const preserved = [modelName(10), "customer-model.stl", modelName(11, "txt"), "00000000-0000-1000-8000-000000000012.stl"];
  await h.write(preserved[0], 10, now);
  for (const filename of preserved.slice(1)) await h.write(filename, 3, stale);
  const result = await cleanupCustomOrderFiles(h.config, now);
  assert.equal(result.removed, 4);
  assert.equal(result.usedBytes, 19);
  assert.deepEqual((await fs.readdir(h.directory)).sort(), preserved.sort());
});

test("active uploads remain protected from expiry until their reservation is released", async (t) => {
  const h = await storage(t);
  const reservation = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => reservation.release());
  await h.write(modelName(1), 25, Date.now() - 10000);
  const protectedScan = await cleanupCustomOrderFiles(h.config);
  assert.equal(protectedScan.removed, 0);
  assert.equal(protectedScan.usedBytes, h.config.maxFileSizeBytes);
  assert.equal((await fs.stat(path.join(h.directory, modelName(1)))).size, 25);
  reservation.release();
  const releasedScan = await cleanupCustomOrderFiles(h.config);
  assert.equal(releasedScan.removed, 1);
  assert.equal(releasedScan.usedBytes, 0);
});

test("unexpected directories are preserved and cause new reservations to fail closed", async (t) => {
  const h = await storage(t);
  const nested = path.join(h.directory, modelName(1));
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "preserved.txt"), "operator file");
  assert.equal((await cleanupCustomOrderFiles(h.config, Date.now() + 100000)).removed, 0);
  assert.equal(await fs.readFile(path.join(nested, "preserved.txt"), "utf8"), "operator file");
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(2)), full);
});

test("cleanup never follows directory links and reservations fail closed for them", async (t) => {
  const h = await storage(t);
  const target = path.join(h.root, "external");
  await fs.mkdir(target);
  const externalFile = path.join(target, modelName(1));
  await fs.writeFile(externalFile, "preserved outside upload storage");
  const link = path.join(h.directory, modelName(2));
  try {
    await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links unavailable in this environment");
    throw error;
  }
  assert.equal((await cleanupCustomOrderFiles(h.config, Date.now() + 100000)).removed, 0);
  assert.ok((await fs.lstat(link)).isSymbolicLink());
  assert.equal(await fs.readFile(externalFile, "utf8"), "preserved outside upload storage");
  await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(3)), full);
});

test("canonical directory aliases share a single reservation quota", async (t) => {
  const h = await storage(t, { maxFileSizeBytes: 60 });
  const alias = path.join(h.root, "alias");
  try {
    await fs.symlink(h.directory, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links unavailable in this environment");
    throw error;
  }
  const reservation = await reserveCustomOrderFile(h.config, modelName(1));
  t.after(() => reservation.release());
  await assert.rejects(() => reserveCustomOrderFile({ ...h.config, uploadDir: alias }, modelName(2)), full);
  reservation.release();
  const next = await reserveCustomOrderFile({ ...h.config, uploadDir: alias }, modelName(2));
  assert.equal(next.directory, await fs.realpath(h.directory));
  next.release();
});

test("failed expiry deletion stays charged while cleanup continues for other files", async (t) => {
  const h = await storage(t);
  const blockedFile = await h.write(modelName(1), 70, Date.now() - 10000);
  await h.write(modelName(2), 10, Date.now() - 10000);
  const originalUnlink = fs.unlink;
  const unlinkMock = t.mock.method(fs, "unlink", async (filename) => {
    if (filename === blockedFile) throw Object.assign(new Error("Synthetic deletion failure"), { code: "EACCES" });
    return originalUnlink(filename);
  });
  syncBuiltinESMExports();
  try {
    const result = await cleanupCustomOrderFiles(h.config);
    assert.equal(result.removed, 1);
    assert.equal(result.usedBytes, 70);
    assert.deepEqual(await fs.readdir(h.directory), [modelName(1)]);
    await assert.rejects(() => reserveCustomOrderFile(h.config, modelName(3)), full);
  } finally {
    unlinkMock.mock.restore();
    syncBuiltinESMExports();
  }
});

test("cleanup worker reconciles stale files before resolving and returns a stop callback", async (t) => {
  const h = await storage(t);
  await h.write(modelName(1), 80, Date.now() - 10000);
  const stop = await startCustomOrderCleanup(h.config);
  t.after(stop);
  assert.equal(typeof stop, "function");
  assert.deepEqual(await fs.readdir(h.directory), []);
  const reservation = await reserveCustomOrderFile(h.config, modelName(2));
  reservation.release();
  stop();
});

test("cleanup worker runs recurring passes at the configured interval and can stop", async (t) => {
  const h = await storage(t);
  let tick;
  let unrefCalled = false;
  const timer = { unref() { unrefCalled = true; } };
  const intervalMock = t.mock.method(globalThis, "setInterval", (callback, intervalMs) => {
    assert.equal(intervalMs, h.config.cleanupIntervalMs);
    tick = callback;
    return timer;
  });
  const clearMock = t.mock.method(globalThis, "clearInterval", (value) => assert.equal(value, timer));
  try {
    const stop = await startCustomOrderCleanup(h.config);
    assert.ok(unrefCalled);
    await h.write(modelName(1), 50, Date.now() - 10000);
    await tick();
    assert.deepEqual(await fs.readdir(h.directory), []);
    await h.write(modelName(2), 50, Date.now() - 10000);
    await tick();
    assert.deepEqual(await fs.readdir(h.directory), []);
    stop();
    assert.equal(clearMock.mock.callCount(), 1);
  } finally {
    intervalMock.mock.restore();
    clearMock.mock.restore();
  }
});
