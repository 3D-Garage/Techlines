import { Box, Heading, Stack, Flex, useToast } from "@chakra-ui/react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import CheckoutOrderSummary from "../components/CheckoutOrderSummary";
import ShippingInformation from "../components/ShippingInformation";
import useCheckout from "../hooks/useCheckout";
import { clearPurchasedCartItems } from "../redux/actions/cartAction";
import { resetOrder } from "../redux/actions/orderAction";

const AuthenticatedCheckout = ({ userInfo }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const onPaymentSuccess = (order) => {
    dispatch(clearPurchasedCartItems(order.orderItems || []));
    dispatch(resetOrder());
    navigate("/order-success");
  };
  const onPaymentError = (error) => toast({ description: error?.message || "The payment could not be completed.", status: "error", isClosable: true });
  const checkout = useCheckout({ userId: userInfo._id, token: userInfo.token, onSuccess: onPaymentSuccess, onError: onPaymentError });
  const lockedCheckout = checkout.active && !["FAILED", "EXPIRED"].includes(checkout.active.status) ? checkout.active : null;

  return (
    <Box
      minH={"100vh"}
      maxW={{ base: "3xl", lg: "7xl" }}
      mx={"auto"}
      px={{ base: "4", md: "8", lg: "12" }}
      py={{ base: "6", md: "8", lg: "12" }}
    >
      <Stack direction={{ base: "column", lg: "row" }} align={{ lg: "flex-start" }}>
        <Stack spacing={{ base: "8", md: "10" }} flex={"1.5"} mb={{ base: "12", md: "none" }}>
          <Heading fontSize={"2xl"} fontWeight={"extrabold"}>
            Shipping Information
          </Heading>
          <Stack spacing={"6"}><ShippingInformation lockedCheckout={lockedCheckout} recoveryId={checkout.active?.requestId || checkout.active?.checkoutId} /></Stack>
        </Stack>
        <Flex direction={"column"} align={"center"} flex={"1"}>
          <CheckoutOrderSummary checkout={checkout} onPaymentError={onPaymentError} />
        </Flex>
      </Stack>
    </Box>
  );
};

const CheckOutScreen = () => {
  const { userInfo } = useSelector((state) => state.user);
  const location = useLocation();
  return userInfo ? <AuthenticatedCheckout key={userInfo._id} userInfo={userInfo} /> : <Navigate to="/login" replace state={{ from: location }} />;
};

export default CheckOutScreen;
