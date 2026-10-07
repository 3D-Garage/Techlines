import path from "node:path";
import { mkdir, readdir, readFile, writeFile, lstat, unlink, rmdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { getCustomOrderConfig, prepareCustomOrderUploadDirectory } from "../config/customOrders.js";

export const storedModelFilename = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(stl|obj|step|stp)$/;
const reservationPrefix = ".quota-reservation-";

async function fileStats(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code !== "ENOENT") throw error; return null; }
}

// mkdir is atomic across app processes sharing the upload filesystem. Never
// steal a lock or expire a live reservation: uncertain state fails closed.
async function withStorageLock(directory, action) {
  const lock = path.join(directory, ".quota-lock");
  const deadline = Date.now() + 2000;
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw Object.assign(new Error("Upload storage is busy."), { status: 503 });
      await delay(10);
    }
  }
  try { return await action(); }
  finally { await rmdir(lock); }
}

async function storageEntries(directory) {
  const names = await readdir(directory);
  const reservations = [];
  for (const name of names.filter((name) => name.startsWith(reservationPrefix))) {
    const record = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    if (!storedModelFilename.test(record.filename) || !Number.isSafeInteger(record.bytes) || record.bytes < 1) {
      throw new Error("Invalid upload quota reservation.");
    }
    reservations.push(record);
  }
  return { names, reservations };
}

async function cleanExpired(directory, config, now, entries) {
  const active = new Set(entries.reservations.map((record) => record.filename));
  for (const name of entries.names) {
    if (!storedModelFilename.test(name) || active.has(name)) continue;
    const filename = path.join(directory, name);
    const stats = await fileStats(filename);
    if (stats?.isFile() && !stats.isSymbolicLink() && stats.mtimeMs + config.retentionMs <= now) {
      try { await unlink(filename); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

export async function cleanupExpiredCustomOrderFiles(overrides = {}, now = Date.now()) {
  const config = { ...getCustomOrderConfig(), ...overrides };
  const directory = await prepareCustomOrderUploadDirectory(config.uploadDir);
  await withStorageLock(directory, async () => cleanExpired(directory, config, now, await storageEntries(directory)));
}

export async function reserveCustomOrderStorage(config, filename) {
  const directory = await prepareCustomOrderUploadDirectory(config.uploadDir);
  const reservation = path.join(directory, `${reservationPrefix}${filename}`);
  await withStorageLock(directory, async () => {
    const entries = await storageEntries(directory);
    await cleanExpired(directory, config, Date.now(), entries);
    const active = new Set(entries.reservations.map((record) => record.filename));
    let used = entries.reservations.reduce((sum, record) => sum + record.bytes, 0);
    for (const name of await readdir(directory)) {
      if (name === ".quota-lock" || name.startsWith(reservationPrefix) || active.has(name)) continue;
      const stats = await fileStats(path.join(directory, name));
      if (stats?.isFile()) used += stats.size;
    }
    if (used + config.maxFileSizeBytes > config.storageQuotaBytes) {
      throw Object.assign(new Error("Upload storage quota exceeded."), { status: 507 });
    }
    await writeFile(reservation, JSON.stringify({ filename, bytes: config.maxFileSizeBytes }), { flag: "wx", mode: 0o600 });
  });
  return { directory, reservation };
}

export async function releaseCustomOrderStorage(file) {
  if (!file?.quotaReservation) return;
  await withStorageLock(path.dirname(file.quotaReservation), async () => {
    try { await unlink(file.quotaReservation); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  });
}

export function startCustomOrderCleanupWorker() {
  const cleanup = () => cleanupExpiredCustomOrderFiles().catch(() => console.error("Custom order retention cleanup failed."));
  void cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
