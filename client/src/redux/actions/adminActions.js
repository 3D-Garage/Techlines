import axios from "axios";
import { setAdminLoading, setAdminError, setUsers, removeUser, setOrders, removeOrder, replaceOrder } from "../slices/admin";
import { setProducts } from "../slices/products";

const authConfig = (getState) => ({ headers: { Authorization: `Bearer ${getState().user.userInfo.token}` } });
const messageFor = (error) => error.response?.data?.message || error.response?.data || error.message;

export const getAllUsers = () => async (dispatch, getState) => {
  dispatch(setAdminLoading());
  try { const { data } = await axios.get("/api/users", authConfig(getState)); dispatch(setUsers(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); }
};

export const deleteUser = (id) => async (dispatch, getState) => {
  dispatch(setAdminLoading());
  try { await axios.delete(`/api/users/${id}`, authConfig(getState)); dispatch(removeUser(id)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const getAllOrders = () => async (dispatch, getState) => {
  dispatch(setAdminLoading());
  try { const { data } = await axios.get("/api/orders", authConfig(getState)); dispatch(setOrders(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); }
};

export const deleteOrder = (id) => async (dispatch, getState) => {
  dispatch(setAdminLoading());
  try { await axios.delete(`/api/orders/${id}`, authConfig(getState)); dispatch(removeOrder(id)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const setDelivered = (id) => async (dispatch, getState) => {
  dispatch(setAdminLoading());
  try { const { data } = await axios.put(`/api/orders/${id}`, {}, authConfig(getState)); dispatch(replaceOrder(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const createAdminProduct = (product) => async (dispatch, getState) => {
  try { await axios.post("/api/products", product, authConfig(getState)); const { data } = await axios.get("/api/products"); dispatch(setProducts(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const updateAdminProduct = (id, product) => async (dispatch, getState) => {
  try { await axios.put(`/api/products/${id}`, product, authConfig(getState)); const { data } = await axios.get("/api/products"); dispatch(setProducts(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const deleteAdminProduct = (id) => async (dispatch, getState) => {
  try { await axios.delete(`/api/products/${id}`, authConfig(getState)); const { data } = await axios.get("/api/products"); dispatch(setProducts(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};

export const removeReview = (productId, reviewId) => async (dispatch, getState) => {
  try { await axios.delete(`/api/products/${productId}/reviews/${reviewId}`, authConfig(getState)); const { data } = await axios.get("/api/products"); dispatch(setProducts(data)); }
  catch (error) { dispatch(setAdminError(messageFor(error))); throw error; }
};
