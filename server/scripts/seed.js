import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import User from "../models/User.js";
import Order from "../models/Order.js";

dotenv.config();

const products = [
  {
    name: "Összecsukható telefontartó",
    image: "/favicon.png",
    brand: "3D Garage",
    category: "Kiegészítők",
    description: "Állítható, könnyű telefontartó otthoni vagy irodai használatra.",
    price: 3490,
    stock: 20,
    productIsNew: true,
  },
  {
    name: "Asztali kábelrendező",
    image: "/favicon.png",
    brand: "3D Garage",
    category: "Iroda",
    description: "Öt férőhelyes kábelrendező, amely rendben tartja az íróasztalt.",
    price: 1990,
    stock: 35,
    productIsNew: false,
  },
  {
    name: "Fogaskerék kulcstartó",
    image: "/favicon.png",
    brand: "3D Garage",
    category: "Ajándék",
    description: "Tartós, 3D nyomtatott kulcstartó mozgó fogaskerekekkel.",
    price: 1490,
    stock: 50,
    productIsNew: false,
  },
];

const seed = async () => {
  const mongoUri = process.env.MONGO_URI;
  const adminName = process.env.SEED_ADMIN_NAME || "Local Admin";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@3dgarage.local").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!mongoUri) {
    throw new Error("MONGO_URI is missing from .env.");
  }
  if (!adminPassword || adminPassword.length < 6) {
    throw new Error("SEED_ADMIN_PASSWORD must contain at least 6 characters.");
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  // Create all application collections and declared indexes even when they are empty.
  await Promise.all([User.init(), Product.init(), Order.init()]);

  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = new User({ name: adminName, email: adminEmail, password: adminPassword, isAdmin: true });
  } else {
    admin.name = adminName;
    admin.password = adminPassword;
    admin.isAdmin = true;
  }
  await admin.save();

  let insertedProducts = 0;
  for (const product of products) {
    const result = await Product.updateOne(
      { name: product.name },
      { $setOnInsert: product },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    insertedProducts += result.upsertedCount;
  }

  console.log("Local development database is ready.");
  console.log(`Admin user: ${adminEmail}`);
  console.log(`Seed products added: ${insertedProducts}`);
};

try {
  await seed();
} catch (error) {
  console.error(`Database seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
