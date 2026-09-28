import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = fileURLToPath(new URL("../__tests__/", import.meta.url));
const securityOnly = process.argv.includes("--security");
const testFiles = readdirSync(testsDirectory)
  .filter((fileName) => fileName.endsWith(".test.js"))
  .filter((fileName) => !securityOnly || /^(security|customOrder|authMiddleware)/.test(fileName))
  .sort()
  .map((fileName) => path.join(testsDirectory, fileName));

if (testFiles.length === 0) {
  console.error(`No test files were found in ${testsDirectory}`);
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}
