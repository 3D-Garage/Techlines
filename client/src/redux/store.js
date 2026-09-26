import { combineReducers, configureStore } from "@reduxjs/toolkit";
import products from "./slices/products.js";
import cart from "./slices/cart.js";
import user from "./slices/user.js";
import order from "./slices/order.js";
import admin from "./slices/admin.js";

const reducer = combineReducers({
  products,
  cart,
  user,
  order,
  admin,
});

export default configureStore({
  reducer,
});
