import axios from "axios";
import {
  setError,
  setShippingError,
  shippingAddressAdd,
  orderCreated,
  clearOrder,
  setLoading,
} from "../slices/order.js";

export const setShippingAdress = (data) => (dispatch) => {
  dispatch(shippingAddressAdd(data));
};

export const getShippingAddressError = (value) => (dispatch) => {
  dispatch(setShippingError(value));
};

export const confirmOrder = (paypalOrderId) => async (dispatch, getState) => {
  dispatch(setLoading(true));
  const {
    user: { userInfo },
  } = getState();

  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        authorization: userInfo?.token ? `Bearer ${userInfo.token}` : undefined,
      },
    };
    const { data } = await axios.post("/api/orders/confirm", { orderID: paypalOrderId }, config);
    dispatch(orderCreated(data));
    return data;
  } catch (error) {
    dispatch(
      setError(
        error.response?.data?.message || error.response?.data || error.message ||
          "An unexpected error has occurred. Please try again later"
      )
    );
    throw error;
  }
};

export const resetOrder = () => (dispatch) => dispatch(clearOrder());
