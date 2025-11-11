// Database connector: initialize and log MongoDB connection
import mongoose from "mongoose";

// Connects to Mongo using MONGO_URI from env; logs success/errors
const connectToDatabase = async () => {
  try {
    mongoose.set("strictQuery", false);
    const connect = await mongoose.connect(process.env.MONGO_URI, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });
    console.log(`MongoDB Connected: ${connect.connection.host}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
};

export default connectToDatabase;
