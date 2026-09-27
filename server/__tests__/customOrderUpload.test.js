import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, unlink, rmdir, symlink, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { getCustomOrderConfig, prepareCustomOrderUploadDirectory } from "../config/customOrders.js";
import { validateModelFile } from "../middleware/customOrderUpload.js";

async function checkFile(data, extension, maxSize = 1024 * 1024) {
  const directory = await mkdtemp(path.join(tmpdir(), "techlines-model-check-"));
  const filename = path.join(directory, `model${extension}`);
  try {
    await writeFile(filename, data);
    await validateModelFile({ path: filename, extension }, maxSize);
  } finally {
    await unlink(filename);
    await rmdir(directory);
  }
}

// A worker deadline can interrupt a synchronous parser regression; a normal
// test timeout cannot interrupt a regex that blocks the main event loop.
async function screenInWorker(data, extension) {
  const directory = await mkdtemp(path.join(tmpdir(), "techlines-model-bounds-"));
  const filename = path.join(directory, `model${extension}`);
  let worker;
  let timer;
  try {
    await writeFile(filename, data);
    worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      import(workerData.moduleUrl).then(async ({ validateModelFile }) => {
        try {
          await validateModelFile(workerData.file, workerData.maxSize);
          parentPort.postMessage({ valid: true });
        } catch (error) {
          parentPort.postMessage({ valid: false, status: error.status });
        }
      });
    `, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 64 },
      workerData: {
        moduleUrl: new URL("../middleware/customOrderUpload.js", import.meta.url).href,
        file: { path: filename, extension },
        maxSize: Buffer.byteLength(data) + 1,
      },
    });
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        worker.terminate().then(() => reject(new Error("Upload screening exceeded its 5 second deadline")), reject);
      }, 5000);
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Upload screening worker exited with code ${code}`));
      });
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    await unlink(filename);
    await rmdir(directory);
  }
}

test("upload configuration rejects public roots and invalid size limits", () => {
  for (const directory of ["client/public/models", "client/build", "public/uploads", ".git/uploads", "."]) {
    assert.throws(() => getCustomOrderConfig({ CUSTOM_ORDER_UPLOAD_DIR: directory }), /outside/);
  }
  for (const limit of ["0", "-1", "no-limit", "Infinity", "101"]) {
    assert.throws(() => getCustomOrderConfig({ CUSTOM_ORDER_MAX_FILE_SIZE_MB: limit }), /must/);
  }
  assert.equal(getCustomOrderConfig({ CUSTOM_ORDER_MAX_FILE_SIZE_MB: "2.5" }).maxFileSizeBytes, 2621440);
});

test("resolved upload directory rejects junctions or symlinks into the frontend", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "techlines-upload-location-"));
  const link = path.join(directory, "private-looking-path");
  let linked = false;
  try {
    const frontend = fileURLToPath(new URL("../../client/public/", import.meta.url));
    try {
      await symlink(frontend, link, process.platform === "win32" ? "junction" : "dir");
      linked = true;
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        t.skip("This environment cannot create directory links");
        return;
      }
      throw error;
    }
    assert.equal(getCustomOrderConfig({ CUSTOM_ORDER_UPLOAD_DIR: link }).uploadDir, link);
    await assert.rejects(() => prepareCustomOrderUploadDirectory(link), /outside/);
  } finally {
    if (linked) await unlink(link);
    await rmdir(directory);
  }
});

test("private upload directories return their canonical filesystem location", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "techlines-private-location-"));
  try {
    assert.equal(await prepareCustomOrderUploadDirectory(directory), await realpath(directory));
  } finally {
    await rmdir(directory);
  }
});

test("accepts binary STL only when triangle count matches the full file", async () => {
  const binary = Buffer.alloc(134);
  binary.write("solid binary STL (header may start with solid)");
  binary.writeUInt32LE(1, 80);
  await checkFile(binary, ".stl");
  await assert.rejects(() => checkFile(binary.subarray(0, 133), ".stl"), { status: 400 });
  await assert.rejects(() => checkFile(Buffer.concat([binary, Buffer.from("trailing script")]), ".stl"), { status: 400 });
});

test("rejects executables, archives, empty files and scripts renamed to model extensions", async () => {
  const fakeBinary = Buffer.alloc(134);
  fakeBinary.write("MZ");
  fakeBinary.writeUInt32LE(1, 80);
  const payloads = [fakeBinary, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from("PK archive"), Buffer.alloc(0), Buffer.from("<script>alert(1)</script>"), Buffer.from("#!/bin/sh\necho dangerous")];
  for (const extension of [".stl", ".obj", ".step", ".stp"]) {
    for (const payload of payloads) {
      await assert.rejects(() => checkFile(payload, extension), { status: 400 });
    }
  }
});

test("accepts OBJ geometry but rejects executable OBJ commands and binary .obj files", async () => {
  const obj = "# test\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
  await checkFile(obj, ".obj");
  await assert.rejects(() => checkFile(`${obj}csh malicious.sh\n`, ".obj"), { status: 400 });
  await assert.rejects(() => checkFile(`${obj}call malicious.obj\n`, ".obj"), { status: 400 });
  await assert.rejects(() => checkFile(Buffer.from([0xff, 0xfe, 0, 0]), ".obj"), { status: 400 });
  await assert.rejects(() => checkFile(obj, ".obj", 10), { status: 413 });
});

test("STEP envelope requires real sections and entities, not markers in comments", async () => {
  const valid = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n";
  await checkFile(valid, ".step");
  await checkFile(valid, ".stp");
  await assert.rejects(() => checkFile(`/* ${valid} */`, ".step"), { status: 400 });
  await assert.rejects(() => checkFile(valid.replace("DATA;", "BROKEN;"), ".step"), { status: 400 });
  await assert.rejects(() => checkFile(`${valid}<script>alert(1)</script>`, ".step"), { status: 400 });
  await checkFile(valid.replace("#1=CARTESIAN_POINT('',(0.,0.,0.));", "/* comment with 'quotes' */ #1=CARTESIAN_POINT('it''s a /* literal */ label',(0.,0.,0.));"), ".step");
  await assert.rejects(() => checkFile(valid.replace("ENDSEC;\nDATA;", "DATA;"), ".step"), { status: 400 });
  await assert.rejects(() => checkFile(valid.replace("(0.,0.,0.)", "(0.,0.,0."), ".step"), { status: 400 });
});

test("STEP screening bounds hostile missing sections, comments and quoted strings", async () => {
  const header = "ISO-10303-21;HEADER;FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));ENDSEC;DATA;";
  for (const payload of [
    `${header}${"#1=A();".repeat(180000)}END-ISO-10303-21;`,
    `${header}${"/* ".repeat(200000)}`,
    `${header}#1=A('${"''".repeat(300000)}`,
  ]) {
    assert.deepEqual(await screenInWorker(payload, ".step"), { valid: false, status: 400 });
  }
});

test("OBJ screening does not materialize huge argument or empty-line arrays", async () => {
  assert.deepEqual(await screenInWorker(`v ${"1 ".repeat(1000000)}`, ".obj"), { valid: false, status: 400 });
  assert.deepEqual(await screenInWorker(`${"\n".repeat(1000000)}v 0 0 0\np 1\n`, ".obj"), { valid: true });
});

test("ASCII STL and OBJ accept CR-only line endings", async () => {
  const stl = "solid test\rfacet normal 0 0 1\router loop\rvertex 0 0 0\rvertex 1 0 0\rvertex 0 1 0\rendloop\rendfacet\rendsolid test\r";
  await checkFile(stl, ".stl");
  await checkFile("v 0 0 0\rv 1 0 0\rv 0 1 0\rf 1 2 3\r", ".obj");
});
