import { once } from "node:events";
import mongoose from "mongoose";
import { createApp } from "../../app.js";
import { initializeCheckout } from "../../services/checkoutService.js";

let server;
process.once("disconnect", async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  await mongoose.disconnect();
});

try {
  await mongoose.connect(process.env.QA_MONGO_URI, { dbName: process.env.QA_MONGO_DATABASE, autoIndex: false });
  await initializeCheckout();
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  process.send({ url: `http://127.0.0.1:${server.address().port}` });
} catch (error) {
  process.send({ error: error.message });
  process.exitCode = 1;
}
