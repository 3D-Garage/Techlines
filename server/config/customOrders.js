import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, realpath, stat } from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([".stl", ".obj", ".step", ".stp"]);
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
  const uploadDir = path.resolve(projectRoot, env.CUSTOM_ORDER_UPLOAD_DIR || "private-uploads/custom-orders");
  // The entire frontend tree is excluded, including both dev and production roots.
  if (uploadDir === path.resolve(projectRoot) || forbiddenRoots.some((root) => isWithin(uploadDir, path.join(projectRoot, root)))) {
    throw new Error("Custom order uploads must be stored outside web and source-control directories.");
  }
  return { uploadDir, maxFileSizeBytes, supportedExtensions: [...SUPPORTED_MODEL_EXTENSIONS] };
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
