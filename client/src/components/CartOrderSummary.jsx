import { Button, Flex, Heading, Stack, Text, useColorModeValue as mode, Badge } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { FaArrowRight } from "react-icons/fa";
import { useSelector } from "react-redux";
import { Link as ReactLink, useNavigate } from "react-router-dom";

const CartOrderSummary = () => {
  const [buttonLoading, setButtonLoading] = useState();
  const [quote, setQuote] = useState({
    subtotal: 0,
    shippingMethod: "standard",
    shippingPrice: 0,
    total: 0,
    currency: "HUF",
  });
  const cartItems = useSelector((state) => state.cart);
  const { cart } = cartItems;
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const fetchQuote = async () => {
      if (!cart.length) {
        setQuote({ subtotal: 0, shippingMethod: "standard", shippingPrice: 0, total: 0, currency: "HUF" });
        return;
      }

      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map((item) => ({ productId: item.id, qty: item.qty })),
            shippingMethod: "standard",
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || "Unable to calculate cart quote");
        if (isMounted) setQuote(data);
      } catch (error) {
        console.error("Cart quote failed", error);
      }
    };

    fetchQuote();
    return () => {
      isMounted = false;
    };
  }, [cart]);

  const checkoutHandler = () => {
    setButtonLoading(true);
    navigate("/checkout");
  };

  return (
    <Stack spacing={8} borderWidth={"1px"} rounded={"lg"} padding={8} w={"full"}>
      <Heading size={"md"} y>
        Order Summary
      </Heading>
      <Stack spacing={"6"}>
        <Flex justify={"space-between"}>
          <Text fontWeight={"medium"} color={mode("gray.600", "gray.400")}>
            Subtotal
          </Text>
          <Text fontWeight={"medium"}>{Number(quote.subtotal || 0).toLocaleString("hu-HU")} Ft</Text>
        </Flex>
        <Flex justify={"space-between"}>
          <Text fontWeight={"medium"} color={mode("gray.600", "gray.400")}>
            Shipping
          </Text>
          <Text fontWeight={"medium"}>
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
          <Text fontSize="l" fontWeight="extrabold">
            Total
          </Text>
          <Text fontSize="l" fontWeight="extrabold">
            {Number(quote.total || 0).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
      </Stack>
      <Button
        as={ReactLink}
        to="/checkout"
        colorScheme="purple"
        size="lg"
        fontSize="md"
        rightIcon={<FaArrowRight />}
        isLoading={buttonLoading}
        onClick={() => checkoutHandler()}
      >
        Checkout
      </Button>
    </Stack>
  );
};
export default CartOrderSummary;
