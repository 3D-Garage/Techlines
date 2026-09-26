import {
  Flex,
  Heading,
  Stack,
  Text,
  useColorModeValue as mode,
  Badge,
  Box,
  Link,
  Divider,
  useToast,
  Alert,
  AlertIcon,
  Button,
} from "@chakra-ui/react";
import { useDispatch, useSelector } from "react-redux";
import { Link as ReactLink, useNavigate } from "react-router-dom";
import { PhoneIcon, EmailIcon, ChatIcon } from "@chakra-ui/icons";
import { confirmOrder, resetOrder } from "../redux/actions/orderAction.js";
import { useEffect, useState, useCallback } from "react";
import CheckoutItem from "./CheckoutItem.jsx";
import PayPalButton from "./PayPalButton.jsx";
import { resetCart } from "../redux/actions/cartAction.js";

const PENDING_PAYPAL_ORDER_KEY = "pendingPayPalOrderId";

const CheckoutOrderSummary = () => {
  const colorMode = mode("gray.600", "gray.400");
  const cartItems = useSelector((state) => state.cart);
  const { cart, subtotal, expressShipping } = cartItems;
  const user = useSelector((state) => state.user);
  const { userInfo } = user;
  const pendingOrderStorageKey = `${PENDING_PAYPAL_ORDER_KEY}:${userInfo?._id || "anonymous"}`;
  const shippingInfo = useSelector((state) => state.order);
  const { shippingError, shippingAddress, loading } = shippingInfo;
  const [buttonDisabled, setButtonDisabled] = useState(true);
  const [serverQuote, setServerQuote] = useState(null);
  const [pendingPayPalOrderId, setPendingPayPalOrderId] = useState(
    () => localStorage.getItem(pendingOrderStorageKey) || "",
  );
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();

  const shipping = useCallback(
    () =>
      serverQuote
        ? Number(serverQuote.shippingPrice || 0)
        : expressShipping === "true"
          ? 3990
          : subtotal < 10000
            ? 1490
            : 0,
    [expressShipping, serverQuote, subtotal],
  );

  const total = useCallback(
    () =>
      Number(
        serverQuote
          ? Number(serverQuote.totalPrice || 0)
          : shipping() === 0
            ? Number(subtotal)
            : Number(subtotal) + shipping(),
      ).toFixed(2),
    [serverQuote, shipping, subtotal],
  );

  const quote = serverQuote || {
    subtotal: Number(subtotal) || 0,
    shippingPrice: shipping(),
    totalPrice: Number(total()) || 0,
    currency: "HUF",
  };
  useEffect(() => {
    setButtonDisabled(
      Boolean(shippingError) ||
        !shippingAddress ||
        cart.length === 0 ||
        loading ||
        Boolean(pendingPayPalOrderId),
    );
  }, [shippingError, shippingAddress, cart.length, loading, pendingPayPalOrderId]);

  const onPaymentSuccess = async (paypalOrderId) => {
    setPendingPayPalOrderId(paypalOrderId);
    localStorage.setItem(pendingOrderStorageKey, paypalOrderId);
    try {
      const order = await dispatch(confirmOrder(paypalOrderId));
      localStorage.removeItem(pendingOrderStorageKey);
      setPendingPayPalOrderId("");
      dispatch(resetCart());
      dispatch(resetOrder());
      navigate("/order-success");
      return order;
    } catch (error) {
      // These responses prove this user cannot recover this checkout. Ambiguous
      // network/provider failures retain the ID so a retry cannot double-charge.
      if ([403, 404, 410].includes(error?.response?.status)) {
        localStorage.removeItem(pendingOrderStorageKey);
        setPendingPayPalOrderId("");
      }
      throw error;
    }
  };

  const onPaymentError = (e) => {
    toast({
      description:
        e?.response?.data?.message || e?.message || "Order confirmation failed. Please retry safely.",
      status: "error",
      isClosable: true,
    });
  };

  return (
    <Stack spacing="8" rounded="xl" padding="8" width="full">
      <Heading size="md">Order Summary</Heading>
      {cart.map((item) => (
        <CheckoutItem key={item.id} cartItem={item} />
      ))}
      <Stack spacing="6">
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Subtotal
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {Number(quote.subtotal).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Shipping
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {Number(quote.shippingPrice) === 0 ? (
              <Badge rounded="full" px="2" fontSize="0.8em" colorScheme="green">
                Free
              </Badge>
            ) : (
              `${Number(quote.shippingPrice).toLocaleString("hu-HU")} Ft`
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="semibold" fontSize="lg">
            Total
          </Text>
          <Text fontSize="xl" fontWeight="extrabold">
            {Number(quote.totalPrice).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
      </Stack>
      <Stack>
        <PayPalButton
          cart={cart}
          shippingAddress={shippingAddress}
          shippingMethod={expressShipping === "true" ? "express" : "standard"}
          token={userInfo?.token}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentError={onPaymentError}
          onQuoteReceived={setServerQuote}
          disabled={buttonDisabled}
        />
        {pendingPayPalOrderId && (
          <Stack mt="4" spacing="3">
            <Alert status="warning" rounded="md">
              <AlertIcon />
              Payment approval was received, but confirmation did not finish. Retry with the same PayPal
              order; you will not be charged twice.
            </Alert>
            <Button
              colorScheme="purple"
              isLoading={loading}
              onClick={() => onPaymentSuccess(pendingPayPalOrderId).catch(onPaymentError)}
            >
              Retry order confirmation
            </Button>
          </Stack>
        )}
      </Stack>
      <Box align="center">
        <Text fontSize="sm">Have questions? or need help to complete your order?</Text>
        <Flex justifyContent="center" color={mode("purple.500", "purple.100")}>
          <Flex align="center">
            <ChatIcon />
            <Text m="2">Live Chat</Text>
          </Flex>
          <Flex align="center">
            <PhoneIcon />
            <Text m="2">Phone</Text>
          </Flex>
          <Flex align="center">
            <EmailIcon />
            <Text m="2">Email</Text>
          </Flex>
        </Flex>
      </Box>
      <Divider bg={mode("gray.400", "gray.800")} />
      <Flex justifyContent="center" my="6" fontWeight="semibold">
        <p>or</p>
        <Link as={ReactLink} to="/products" ml="1">
          Continue Shopping
        </Link>
      </Flex>
    </Stack>
  );
};

export default CheckoutOrderSummary;
