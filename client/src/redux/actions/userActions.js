// User actions: login/logout, register, and profile update
import axios from "axios";
import user, {
  setLoading,
  setError,
  userLogin,
  userLogout,
  updateUserProfile,
  resetUpdate,
} from "../slices/user";

// Authenticate and store user
export const login = (email, password) => async (dispatch) => {
  dispatch(setLoading(true));
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
      },
    };
    const { data } = await axios.post("/api/users/login", { email, password }, config);
    dispatch(userLogin(data));
    localStorage.setItem("userInfo", JSON.stringify(data));
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

// Clear user from storage and state
export const logout = () => (dispatch) => {
  localStorage.removeItem("userInfo");
  dispatch(userLogout());
};

// Create new account
export const register = (name, email, password) => async (dispatch) => {
  dispatch(setLoading(true));
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
      },
    };
    const { data } = await axios.post("/api/users/register", { name, email, password }, config);
    dispatch(userLogin(data));
    localStorage.setItem("userInfo", JSON.stringify(data));
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

// Update user profile
export const updateProfile = (id, name, email, password) => async (dispatch, getState) => {
  const {
    user: { userInfo },
  } = getState();
  try {
    const config = {
      headers: {
        authorization: `Bearer ${userInfo.token}`,
        "Content-Type": "application/json",
      },
    };
    const { data } = await axios.put(`/api/users/profile/${id}`, { _id: id, name, email, password }, config);
    localStorage.setItem("userInfo", JSON.stringify(data));
    dispatch(updateUserProfile(data));
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

// Reset update success flag
export const resetUpdateSuccess = () => async (dispatch) => {
  dispatch(resetUpdate());
};
