import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chmod, open, readFile, unlink } from "node:fs/promises";
import { getCustomOrderConfig, prepareCustomOrderUploadDirectory, SUPPORTED_MODEL_EXTENSIONS } from "../config/customOrders.js";

const MIME_TYPES = {
  ".stl": "model/stl",
  ".obj": "model/obj",
  ".step": "model/step",
  ".stp": "model/step",
};
const numeric = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const vector = `${numeric}\\s+${numeric}\\s+${numeric}`;
const normalLine = new RegExp(`^facet\\s+normal\\s+${vector}$`, "i");
const vertexLine = new RegExp(`^vertex\\s+${vector}$`, "i");
const objVertex = new RegExp(`^v\\s+${vector}(?:\\s+${numeric}){0,4}$`);
const objIndex = /^[+-]?[1-9]\d*(?:\/(?:[+-]?[1-9]\d*)?(?:\/[+-]?[1-9]\d*)?)?$/;
const objCommands = new Set([
  "v", "vt", "vn", "vp", "f", "l", "p", "o", "g", "s", "mtllib", "usemtl",
  "cstype", "deg", "bmat", "step", "curv", "curv2", "surf", "parm", "trim",
  "hole", "scrv", "sp", "end", "con", "bevel", "c_interp", "d_interp", "lod",
  "shadow_obj", "trace_obj", "ctech", "stech", "maplib", "usemap",
]);

function uploadError(message, status = 400) {
  return Object.assign(new Error(message), { status, errors: { modelFile: message } });
}

// Iterate instead of splitting the whole upload into arrays. Empty lines and
// enormous token lists otherwise amplify a small upload into a large allocation.
function* lines(text) {
  for (const match of text.matchAll(/[^\r\n]+/g)) yield match[0];
}

function isAsciiStl(text) {
  let state = "solid";
  let vertices = 0;
  let facets = 0;
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (!line) continue;
    if (state === "solid" && /^solid(?:\s.*)?$/i.test(line)) state = "facet";
    else if (state === "facet" && normalLine.test(line)) state = "loop";
    else if (state === "loop" && /^outer\s+loop$/i.test(line)) { vertices = 0; state = "vertex"; }
    else if (state === "vertex" && vertexLine.test(line)) { if (++vertices === 3) state = "endloop"; }
    else if (state === "endloop" && /^endloop$/i.test(line)) state = "endfacet";
    else if (state === "endfacet" && /^endfacet$/i.test(line)) { facets++; state = "facet"; }
    else if (state === "facet" && /^endsolid(?:\s.*)?$/i.test(line)) state = "solid";
    else return false;
  }
  return facets > 0 && state === "solid";
}

function isObj(text) {
  let vertices = 0;
  let geometry = false;
  for (const raw of lines(text.replace(/\\(?:\r\n|\r|\n)/g, " "))) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const separator = line.search(/\s/);
    const command = separator === -1 ? line : line.slice(0, separator);
    const args = separator === -1 ? "" : line.slice(separator).trim();
    if (!objCommands.has(command)) return false;
    if (command === "v") {
      if (!objVertex.test(line)) return false;
      vertices++;
    }
    if (["f", "l", "p"].includes(command)) {
      const minimum = command === "f" ? 3 : command === "l" ? 2 : 1;
      let count = 0;
      for (const match of args.matchAll(/\S+/g)) {
        if (!objIndex.test(match[0])) return false;
        count++;
      }
      if (count < minimum) return false;
      geometry = true;
    }
    if (["curv", "surf"].includes(command) && args.length > 0) geometry = true;
  }
  return vertices > 0 && geometry;
}

const isDigit = (code) => code >= 48 && code <= 57;
const isLetter = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

// A bounded-memory lexer skips each comment and quoted string once. Broad
// comment/section regexes can repeatedly rescan malformed files and block Node.
function* stepTokens(text) {
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) { yield null; return; }
      index = end + 2;
      continue;
    }
    if (char === "'") {
      index++;
      let closed = false;
      while (index < text.length) {
        const end = text.indexOf("'", index);
        if (end === -1) break;
        index = end + 1;
        if (text[index] === "'") index++;
        else { closed = true; break; }
      }
      if (!closed) { yield null; return; }
      yield { type: "string" };
      continue;
    }
    const code = text.charCodeAt(index);
    if (isLetter(code) || isDigit(code)) {
      const start = index++;
      while (index < text.length) {
        const next = text.charCodeAt(index);
        if (!isLetter(next) && !isDigit(next) && next !== 45) break;
        index++;
      }
      // Part 21 keywords/entity IDs are short; never retain an unbounded token.
      if (index - start > 128) { yield null; return; }
      yield { type: "word", value: text.slice(start, index).toUpperCase() };
      continue;
    }
    index++;
    yield { type: "symbol", value: char };
  }
}

function isStep(text) {
  // Check the Part 21 envelope/sections, without interpreting geometry or
  // following references. Only a short statement prefix is retained.
  let phase = "signature";
  let hasSchema = false;
  let hasEntity = false;
  let depth = 0;
  let count = 0;
  let last;
  let prefix = [];
  for (const token of stepTokens(text)) {
    if (!token || phase === "done") return false;
    if (token.value === ";") {
      if (depth !== 0 || !count) return false;
      const word = prefix[0]?.type === "word" ? prefix[0].value : undefined;
      const single = count === 1;
      const call = prefix[1]?.value === "(" && last === ")";
      if (phase === "signature" && single && word === "ISO-10303-21") phase = "headerStart";
      else if (phase === "headerStart" && single && word === "HEADER") phase = "header";
      else if (phase === "header" && single && word === "ENDSEC" && hasSchema) phase = "dataStart";
      else if (phase === "header" && /^[A-Z_][A-Z_0-9]*$/.test(word || "") && call) {
        if (word === "FILE_SCHEMA") hasSchema = true;
      } else if (["dataStart", "afterData"].includes(phase) && word === "DATA" && (single || call)) {
        phase = "data";
        hasEntity = false;
      } else if (phase === "data" && single && word === "ENDSEC" && hasEntity) phase = "afterData";
      else if (phase === "data" && prefix[0]?.value === "#" && /^\d+$/.test(prefix[1]?.value || "")
        && prefix[2]?.value === "=" && last === ")"
        && (prefix[3]?.value === "(" || (/^[A-Z_][A-Z_0-9]*$/.test(prefix[3]?.value || "") && prefix[4]?.value === "("))) {
        hasEntity = true;
      } else if (phase === "afterData" && single && word === "END-ISO-10303-21") phase = "done";
      else return false;
      count = 0;
      prefix = [];
      last = undefined;
      continue;
    }
    if (token.value === "(") depth++;
    if (token.value === ")" && --depth < 0) return false;
    if (prefix.length < 5) prefix.push(token);
    count++;
    last = token.value;
  }
  return phase === "done" && count === 0;
}

export async function validateModelFile(file, maxFileSizeBytes) {
  const handle = await open(file.path, "r");
  try {
    const { size } = await handle.stat();
    if (!size) throw uploadError("A modellfájl nem lehet üres.");
    if (size > maxFileSizeBytes) throw uploadError("A modellfájl meghaladja a megengedett méretet.", 413);
    const header = Buffer.alloc(84);
    await handle.read(header, 0, header.length, 0);
    if (header.subarray(0, 2).equals(Buffer.from("MZ"))
      || header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || header.subarray(0, 2).equals(Buffer.from("PK"))) {
      throw uploadError("A fájl tartalma nem támogatott 3D modell.");
    }
    // Binary STL has an 80-byte header, uint32 triangle count, and 50 bytes per triangle.
    if (file.extension === ".stl" && size >= 84 && header.readUInt32LE(80) > 0
      && size === 84 + 50 * header.readUInt32LE(80)) return;
  } finally {
    await handle.close();
  }
  const data = await readFile(file.path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw uploadError("A fájl tartalma nem támogatott 3D modell.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw uploadError("A fájl tartalma nem támogatott 3D modell.");
  }
  const valid = file.extension === ".stl" ? isAsciiStl(text)
    : file.extension === ".obj" ? isObj(text) : isStep(text);
  if (!valid) throw uploadError("A fájl tartalma nem felel meg a kiválasztott 3D formátumnak.");
}

export async function removeCustomOrderFile(file) {
  if (!file?.path) return;
  try {
    await unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function createCustomOrderUpload(overrides = {}) {
  return async (req, res, next) => {
    try {
      const config = { ...getCustomOrderConfig(), ...overrides };
      const storage = multer.diskStorage({
        destination(_req, _file, callback) {
          prepareCustomOrderUploadDirectory(config.uploadDir)
            .then((directory) => callback(null, directory), callback);
        },
        filename(_req, file, callback) {
          callback(null, `${randomUUID()}${file.extension}`);
        },
      });
      const upload = multer({
        storage,
        defParamCharset: "utf8",
        limits: { fileSize: config.maxFileSizeBytes, files: 1, fields: 7, parts: 8, fieldNameSize: 100, fieldSize: 40000, fieldArrayIndexLimit: 0 },
        fileFilter(_req, file, callback) {
          const originalName = file.originalname.normalize("NFC");
          const extension = path.extname(originalName).toLowerCase();
          if (!SUPPORTED_MODEL_EXTENSIONS.includes(extension)
            || originalName.length > 200 || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(originalName)
            || /\.(?:exe|com|bat|cmd|ps1|js|vbs|sh|php|html?|dll|scr)(?:\.|$)/i.test(originalName)) {
            callback(uploadError("Csak .stl, .obj, .step vagy .stp modellfájl tölthető fel."));
            return;
          }
          file.originalname = originalName;
          file.extension = extension;
          // MIME supplied by the browser is untrusted; record our validated format instead.
          file.mimetype = MIME_TYPES[extension];
          callback(null, true);
        },
      }).single("modelFile");
      upload(req, res, (error) => {
        (async () => {
          if (error) {
            if (error instanceof multer.MulterError) {
              const tooLarge = error.code === "LIMIT_FILE_SIZE";
              throw uploadError(tooLarge ? "A modellfájl meghaladja a megengedett méretet." : "Érvénytelen feltöltés: legfeljebb egy modellfájl és a megadott űrlapmezők küldhetők.", tooLarge ? 413 : 400);
            }
            if (error.status) throw error;
            // Malformed multipart bodies also use controlled errors.
            if (/multipart|unexpected end/i.test(error.message)) throw uploadError("Hiányos vagy érvénytelen fájlfeltöltés.");
            throw error;
          }
          if (req.file) {
            await chmod(req.file.path, 0o600);
            await validateModelFile(req.file, config.maxFileSizeBytes);
          }
          next();
        })().catch(async (failure) => {
          try { await removeCustomOrderFile(req.file); }
          catch { console.error("Custom order rejected upload cleanup failed."); }
          next(failure);
        });
      });
    } catch (error) {
      next(error);
    }
  };
}
