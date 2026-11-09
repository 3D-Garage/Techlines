// Keep the test server in the runner process so teardown works on Windows too.
import { resolve } from "node:path";
import { createApp } from "../server/app.js";
export default async function setup() {
  const app = createApp({ storefrontDirectory: resolve("client/build"), cspMode: "enforce" });
  const server = app.listen(4173, "127.0.0.1");
  await new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
  return async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  };
}
