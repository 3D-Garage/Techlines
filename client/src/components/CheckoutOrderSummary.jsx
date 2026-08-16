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
} from "@chakra-ui/react";
import { useDispatch, useSelector } from "react-redux";
import { Link as ReactLink, useNavigate } from "react-router-dom";
import { PhoneIcon, EmailIcon, ChatIcon } from "@chakra-ui/icons";
import { createOrder, resetOrder } from "../redux/actions/orderAction";
import { useEffect, useState, useCallback } from "react";
import CheckoutItem from "./CheckoutItem";
import PayPalButton from "./PayPalButton";
import { resetCart } from "../redux/actions/cartAction";
const CheckoutOrderSummary = () => {
  const colorMode = mode("gray.600", "gray.400");
  const cartItems = useSelector((state) => state.cart);
  const { cart, subtotal, expressShipping } = cartItems;
  const user = useSelector((state) => state.user);
  const { userInfo } = user;
  const shippingInfo = useSelector((state) => state.order);
  const { error, shippingAddress } = shippingInfo;
  const [buttonDisabled, setButtonDisabled] = useState(true);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();

  const shipping = useCallback(
    () => (expressShipping === "true" ? 3990 : subtotal < 10000 ? 1490 : 0),
    [expressShipping, subtotal]
  );

  const total = useCallback(
    () => Number(shipping() === 0 ? Number(subtotal) : Number(subtotal) + shipping()).toFixed(2),
    [shipping, subtotal]
  );
  useEffect(() => {
    setButtonDisabled(Boolean(error) || !shippingAddress || cart.length === 0);
  }, [error, shippingAddress, cart.length]);

  const onPaymentSuccess = async (capture) => {
    const paymentDetails = {
      orderId: capture?.id,
      payerId: capture?.payer?.payer_id,
    };
    const orderItems = cart.map((i) => ({
      product_id: i.id,
      name: i.name,
      image: i.image,
      price: i.price,
      qty: i.qty,
    }));
    const payload = {
      orderItems,
      paymentMethod: "PayPal",
      shippingPrice: Math.round(shipping()),
      totalPrice: Number(total()),
      paymentDetails,
    };
    try {
      await dispatch(createOrder(payload));
      dispatch(resetCart());
      dispatch(resetOrder());
      navigate("/order-success");
    } catch (_error) {
      toast({ description: "The payment was captured, but the order could not be saved. Please contact support.", status: "error", duration: 12000, isClosable: true });
    }
  };

  const onPaymentError = (e) => {
    toast({ description: e?.message || "The payment could not be completed.", status: "error", isClosable: true });
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
            {Number(subtotal).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Shipping
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {shipping() === 0 ? (
              <Badge rounded="full" px="2" fontSize="0.8em" colorScheme="green">
                Free
              </Badge>
            ) : (
              `${Number(shipping()).toLocaleString("hu-HU")} Ft`
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="semibold" fontSize="lg">
            Total
          </Text>
          <Text fontSize="xl" fontWeight="extrabold">
            {Number(total()).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
      </Stack>
      <Stack>
        <PayPalButton
          total={total}
          cart={cart}
          shippingPrice={shipping()}
          token={userInfo?.token}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentError={onPaymentError}
          disabled={buttonDisabled}
        />
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
