import axios from "axios";
import {
  setProducts,
  setLoading,
  setError,
  setProduct,
  productReviewed,
  resetProductStatus,
} from "../slices/products";

export const getProducts = () => async (dispatch) => {
  dispatch(setLoading(true));
  try {
    const { data } = await axios.get("/api/products");
    dispatch(setProducts(data));
  } catch (error) {
    dispatch(
      setError(
        error.response && error.response.data.message
          ? error.response.data.message
          : error.message
          ? error.message
          : "An unexpected error has occured. Please try again later."
      )
    );
  }
};

export const getProduct = (id) => async (dispatch) => {
  dispatch(setLoading(true));
  try {
    const { data } = await axios.get(`/api/products/${id}`);
    dispatch(setProduct(data));
  } catch (error) {
    dispatch(
      setError(
        error.response && error.response.data.message
          ? error.response.data.message
          : error.message
          ? error.message
          : "An unexpected error has occured. Please try again later."
      )
    );
  }
};

export const createProductReview = (productId, comment, rating, title) => async (dispatch, getState) => {
  dispatch(setLoading(true));
  const { userInfo } = getState().user;
  try {
    const { data } = await axios.post(
      `/api/products/reviews/${productId}`,
      { comment, rating, title },
      { headers: { Authorization: `Bearer ${userInfo.token}` } }
    );
    dispatch(productReviewed(data));
    return data;
  } catch (error) {
    const message = error.response?.data?.message || error.response?.data || error.message;
    dispatch(setError(message));
    throw error;
  }
};

export const resetProductError = () => (dispatch) => dispatch(resetProductStatus());
