import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, realpath, stat } from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([".stl", ".obj", ".step", ".stp"]);
export const STORED_MODEL_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(stl|obj|step|stp)$/;
const forbiddenRoots = ["client", "public", "build", "dist", ".git", ".codex", ".agents"];

function isWithin(directory, parent) {
  const relative = path.relative(parent, directory);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Read lazily: dotenv is initialized after ES module imports in server/index.js.
export function getCustomOrderConfig(env = process.env) {
  const sizeMb = Number(env.CUSTOM_ORDER_MAX_FILE_SIZE_MB || 20);
  if (!Number.isFinite(sizeMb) || sizeMb <= 0 || sizeMb > 100) {
    throw new Error("CUSTOM_ORDER_MAX_FILE_SIZE_MB must be greater than 0 and at most 100.");
  }
  const maxFileSizeBytes = Math.floor(sizeMb * 1024 * 1024);
  if (maxFileSizeBytes < 1) throw new Error("Custom order upload size is too small.");
  const positiveSetting = (name, fallback, multiplier) => {
    const value = Number(env[name] || fallback);
    const converted = Math.floor(value * multiplier);
    if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(converted) || converted < 1) {
      throw new Error(`${name} must be a positive, finite value within the supported range.`);
    }
    return converted;
  };
  const maxStorageBytes = positiveSetting("CUSTOM_ORDER_MAX_STORAGE_MB", 1024, 1024 * 1024);
  const maxFiles = Number(env.CUSTOM_ORDER_MAX_FILES || 10000);
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error("CUSTOM_ORDER_MAX_FILES must be a positive safe integer.");
  }
  if (maxStorageBytes < maxFileSizeBytes) {
    throw new Error("CUSTOM_ORDER_MAX_STORAGE_MB must be at least CUSTOM_ORDER_MAX_FILE_SIZE_MB.");
  }
  const retentionMs = positiveSetting("CUSTOM_ORDER_RETENTION_DAYS", 30, 24 * 60 * 60 * 1000);
  const cleanupIntervalMs = positiveSetting("CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES", 60, 60 * 1000);
  if (cleanupIntervalMs > 2147483647) {
    throw new Error("CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES exceeds the supported timer range.");
  }
  const uploadDir = path.resolve(projectRoot, env.CUSTOM_ORDER_UPLOAD_DIR || "private-uploads/custom-orders");
  // The entire frontend tree is excluded, including both dev and production roots.
  if (uploadDir === path.resolve(projectRoot) || forbiddenRoots.some((root) => isWithin(uploadDir, path.join(projectRoot, root)))) {
    throw new Error("Custom order uploads must be stored outside web and source-control directories.");
  }
  return { uploadDir, maxFileSizeBytes, maxStorageBytes, maxFiles, retentionMs, cleanupIntervalMs, supportedExtensions: [...SUPPORTED_MODEL_EXTENSIONS] };
}

// Lexical checks alone cannot detect a private-looking symlink/junction into a
// served directory. Resolve the actual destination before any upload is written.
export async function prepareCustomOrderUploadDirectory(uploadDir) {
  await mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const [directory, resolvedProjectRoot] = await Promise.all([realpath(uploadDir), realpath(projectRoot)]);
  const forbiddenDirectories = await Promise.all(forbiddenRoots.map(async (root) => {
    const location = path.join(projectRoot, root);
    try { return await realpath(location); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return path.join(resolvedProjectRoot, root);
    }
  }));
  if (directory === resolvedProjectRoot || forbiddenDirectories.some((root) => isWithin(directory, root))) {
    throw new Error("Custom order uploads must be stored outside web and source-control directories.");
  }
  if (!(await stat(directory)).isDirectory()) throw new Error("Custom order upload destination must be a directory.");
  return directory;
}
