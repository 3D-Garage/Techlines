import dotenv from "dotenv";
import createApp from "./app.js";
import connectToDatabase from "./database.js";
import CheckoutSession from "./models/CheckoutSession.js";
import Order from "./models/Order.js";

dotenv.config();

await connectToDatabase();
// Payment replay protection is a database invariant. Do not accept traffic until
// the unique PayPal order, capture, and checkout indexes are available.
await Promise.all([CheckoutSession.createIndexes(), Order.createIndexes()]);

const app = createApp();
const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server runs on port ${port}.`);
});
