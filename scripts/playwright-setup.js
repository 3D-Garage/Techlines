// Keep the test server in the runner process so teardown works on Windows too.
import express from "express";
import { resolve } from "node:path";
export default async function setup() {
  const app = express();
  const root = resolve("client/build");
  app.use(express.static(root));
  app.get("*", (_req, res) => res.sendFile(resolve(root, "index.html")));
  const server = app.listen(4173, "127.0.0.1");
  await new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
  return async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  };
}
