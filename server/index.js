import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import connectToDatabase from "./database.js";
import { getCustomOrderConfig } from "./config/customOrders.js";
import { initializeCheckout, startCheckoutWorker } from "./services/checkoutService.js";
import { createApp } from "./app.js";
import { startCustomOrderCleanupWorker } from "./services/customOrderStorage.js";

dotenv.config();
const storefrontDirectory = process.env.SERVE_STOREFRONT === "true"
  ? fileURLToPath(new URL("../client/build", import.meta.url))
  : undefined;
const app = createApp({ storefrontDirectory });
getCustomOrderConfig();
await connectToDatabase();
startCustomOrderCleanupWorker();
try {
  await initializeCheckout();
  startCheckoutWorker();
} catch (error) {
  console.error(`Checkout disabled: ${error.message}`);
}

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server runs on port ${port}.`);
});
