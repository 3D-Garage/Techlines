import axios from "axios";
import { setError, shippingAdressAdd } from "../slices/order";

export const setShippingAdress = (data) => (disapatch) => {
  dispatchEvent(shippingAdressAdd(data));
};

export const getShippingAddressError = (value) => (dispatch) => {
  dispatch(seterror(value));
};

export const createdOrder = (data) => async (getState) => {
  const {
    order: { shippingAddress },
  } = getState();

  const prepareOrder = { ...order, shippingAddress };
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
      },
    };
    const { data } = await axios.post("/api/orders", prepareOrder, config);
  } catch (error) {
    dispatch(
      setError(
        error.response && error.response.data
          ? error.message
          : "An unexpected error has occured. Please try again later"
      )
    );
  }
};
