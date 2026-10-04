import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Windows/macOS support an explicit directory. Keep build output and runtime logs
// outside the watcher so frontend rebuilds cannot interrupt backend requests.
const watchPaths = ["win32", "darwin"].includes(process.platform) ? ["--watch-path=server"] : [];
const server = spawn(process.execPath, ["--watch", ...watchPaths, "server/index.js"], { cwd: root, stdio: "inherit" });
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
