import dotenv from "dotenv";
import connectToDatabase from "./database.js";
import { getCustomOrderConfig } from "./config/customOrders.js";
import { createApp } from "./app.js";

dotenv.config();
getCustomOrderConfig();
connectToDatabase();

const app = createApp();
const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server runs on port ${port}.`);
});
