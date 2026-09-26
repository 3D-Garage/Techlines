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
import { useEffect, useState } from "react";
import CheckoutItem from "./CheckoutItem";
import PayPalButton from "./PayPalButton";
import { resetCart } from "../redux/actions/cartAction";
const CheckoutOrderSummary = () => {
  const colorMode = mode("gray.600", "gray.400");
  const cartItems = useSelector((state) => state.cart);
  const { cart, expressShipping } = cartItems;
  const user = useSelector((state) => state.user);
  const { userInfo } = user;
  const shippingInfo = useSelector((state) => state.order);
  const { error, shippingAddress } = shippingInfo;
  const [buttonDisabled, setButtonDisabled] = useState(true);
  const [quote, setQuote] = useState({
    items: [],
    subtotal: 0,
    shippingMethod: expressShipping ? "express" : "standard",
    shippingPrice: 0,
    total: 0,
    currency: "HUF",
  });
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();

  const shippingMethod = expressShipping ? "express" : "standard";

  useEffect(() => {
    let isMounted = true;

    const fetchQuote = async () => {
      if (!cart.length) {
        setQuote({ items: [], subtotal: 0, shippingMethod, shippingPrice: 0, total: 0, currency: "HUF" });
        return;
      }

      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map((item) => ({ productId: item.id, qty: item.qty })),
            shippingMethod,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || "Unable to calculate order quote");
        if (isMounted) setQuote(data);
      } catch (quoteError) {
        if (isMounted) {
          toast({
            description: quoteError?.message || "Unable to calculate the latest order totals.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
      }
    };

    fetchQuote();
    return () => {
      isMounted = false;
    };
  }, [cart, shippingMethod, toast]);

  useEffect(() => {
    setButtonDisabled(Boolean(error) || !shippingAddress || cart.length === 0 || !quote.total);
  }, [error, shippingAddress, cart.length, quote.total]);

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
      shippingMethod: quote.shippingMethod,
      paymentDetails,
    };
    try {
      await dispatch(createOrder(payload));
      dispatch(resetCart());
      dispatch(resetOrder());
      navigate("/order-success");
    } catch (_error) {
      toast({
        description: "The payment was captured, but the order could not be saved. Please contact support.",
        status: "error",
        duration: 12000,
        isClosable: true,
      });
    }
  };

  const onPaymentError = (e) => {
    toast({
      description: e?.message || "The payment could not be completed.",
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
            {Number(quote.subtotal || 0).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Shipping
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {quote.shippingPrice === 0 ? (
              <Badge rounded="full" px="2" fontSize="0.8em" colorScheme="green">
                Free
              </Badge>
            ) : (
              `${Number(quote.shippingPrice || 0).toLocaleString("hu-HU")} Ft`
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="semibold" fontSize="lg">
            Total
          </Text>
          <Text fontSize="xl" fontWeight="extrabold">
            {Number(quote.total || 0).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
      </Stack>
      <Stack>
        <PayPalButton
          total={() => quote.total || 0}
          cart={cart}
          shippingMethod={shippingMethod}
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
