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
  Alert, AlertIcon, Button,
} from "@chakra-ui/react";
import { useSelector } from "react-redux";
import { Link as ReactLink } from "react-router-dom";
import { PhoneIcon, EmailIcon, ChatIcon } from "@chakra-ui/icons";
import { useEffect, useState } from "react";
import CheckoutItem from "./CheckoutItem";
import PayPalButton from "./PayPalButton";
import { normalizeRecipientPhone } from "../utils/shipping";
const CheckoutOrderSummary = ({ checkout, onPaymentError }) => {
  const colorMode = mode("gray.600", "gray.400");
  const cartItems = useSelector((state) => state.cart);
  const { cart, shippingMethod } = cartItems;
  const shippingInfo = useSelector((state) => state.order);
  const user = useSelector((state) => state.user.userInfo);
  const { error, shippingAddress, recipientPhone, foxpostLocker, foxpostListReady } = shippingInfo;
  const [quoteError, setQuoteError] = useState("");
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [quoteKey, setQuoteKey] = useState(null);
  const [quote, setQuote] = useState({
    items: [],
    subtotal: 0,
    shippingMethod,
    shippingPrice: 0,
    total: 0,
    currency: "HUF",
  });
  const toast = useToast();
  const active = checkout.active;
  const quoteChange = checkout.quoteChange;
  const locked = Boolean(active && !["FAILED", "EXPIRED"].includes(active.status));
  const pending = active && !["READY", "FAILED", "EXPIRED"].includes(active.status);
  const inputKey = JSON.stringify({ items: cart.map((item) => ({ productId: item.id, qty: item.qty })), shippingMethod });
  const changedQuoteKey = quoteChange && JSON.stringify({ items: quoteChange.input.items, shippingMethod: quoteChange.input.shippingMethod });
  const currentQuote = quoteKey === inputKey ? quote : null;
  const displayedQuote = locked ? active.quote : currentQuote;
  const displayedItems = locked ? (active.quote?.items || []).map((item) => ({ ...item, id: item.productId, price: item.unitPrice })) :
    cart.map((item) => ({ ...item, price: currentQuote?.items.find((quoted) => quoted.productId === item.id)?.unitPrice ?? item.price }));

  const buttonDisabled = Boolean(error) || Boolean(quoteChange && !quoteChange.accepted) || cart.length === 0 || !currentQuote?.total ||
    (shippingMethod === "foxpost" ? !foxpostListReady || !foxpostLocker || !normalizeRecipientPhone(recipientPhone) : !shippingAddress);

  useEffect(() => {
    if (locked) return;
    if (changedQuoteKey === inputKey) {
      setQuote(quoteChange.quote);
      setQuoteKey(inputKey);
      setQuoteError("");
      return;
    }
    let isMounted = true;
    setQuoteKey(null);
    setQuoteError("");

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
        if (isMounted) { setQuote(data); setQuoteKey(inputKey); }
      } catch (quoteError) {
        if (isMounted) {
          setQuoteError(quoteError?.message || "Unable to calculate the latest order totals.");
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
  }, [cart, shippingMethod, inputKey, toast, locked, quoteRetry, quoteChange, changedQuoteKey, active?.status]);

  return (
    <Stack spacing="8" rounded="xl" padding="8" width="full">
      <Heading size="md">Order Summary</Heading>
      {!locked && quoteChange && !quoteChange.accepted && <Alert status="warning"><AlertIcon /><Box>
        <Text>Az ajánlat összege megváltozott.</Text>
        <Text>Korábbi végösszeg: {Number(quoteChange.previousTotal).toLocaleString("hu-HU")} Ft</Text>
        <Text>Új végösszeg: {Number(quoteChange.quote.total).toLocaleString("hu-HU")} Ft</Text>
        <Button mt="2" onClick={checkout.acceptQuote}>Új összeg elfogadása</Button>
      </Box></Alert>}
      {!locked && quoteError && <Alert status="error"><AlertIcon /><Box><Text>{quoteError}</Text><Button size="sm" onClick={() => setQuoteRetry((value) => value + 1)}>Árajánlat újratöltése</Button></Box></Alert>}
      {locked && <Text>This summary shows the saved payment. Other cart items and additional quantities remain in your cart.</Text>}
      {displayedItems.map((item) => (
        <CheckoutItem key={item.id} cartItem={item} readOnly={locked} />
      ))}
      {!displayedQuote && <Text>{locked ? "Loading saved payment details..." : "Árajánlat betöltése..."}</Text>}
      {displayedQuote && <Stack spacing="6">
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Subtotal
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {Number(displayedQuote.subtotal || 0).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="medium" color={colorMode}>
            Shipping
          </Text>
          <Text fontWeight="medium" color={colorMode}>
            {displayedQuote.shippingPrice === 0 ? (
              <Badge rounded="full" px="2" fontSize="0.8em" colorScheme="green">
                Free
              </Badge>
            ) : (
              `${Number(displayedQuote.shippingPrice || 0).toLocaleString("hu-HU")} Ft`
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text fontWeight="semibold" fontSize="lg">
            Total
          </Text>
          <Text fontSize="xl" fontWeight="extrabold">
            {Number(displayedQuote.total || 0).toLocaleString("hu-HU")} Ft
          </Text>
        </Flex>
      </Stack>}
      <Stack>
        {active && <Alert status={active.status === "REVIEW" ? "warning" : "info"}><AlertIcon /><Box>
          <Text>{pending ? "A fizetés ellenőrzése folyamatban. A kosár megmarad; ne indíts új fizetést." : active.status === "READY" ? "Folytasd a már előkészített PayPal-fizetést." : "A fizetés sikertelen vagy az ajánlat lejárt."}</Text>
          {active.shippingAddress && <Text>Szállítás: {active.shippingAddress.address}, {active.shippingAddress.postalCode} {active.shippingAddress.city}, {active.shippingAddress.country}</Text>}
          {active.total && <Text>Rögzített összeg: {active.total.toLocaleString("hu-HU")} Ft</Text>}
        </Box></Alert>}
        {active?.status === "READY" && <Button isLoading={checkout.cancelling} loadingText="Megszakítás ellenőrzése" onClick={() => checkout.cancel()}>Rendelés módosítása</Button>}
        {active && ["FAILED", "EXPIRED"].includes(active.status) && <Button onClick={checkout.reset}>Új fizetés előkészítése</Button>}
        <Box display={!pending && (!active || active.status === "READY") ? "block" : "none"}>
          <PayPalButton
            total={() => displayedQuote?.total || 0}
            cart={displayedItems}
            shippingMethod={locked ? active.quote?.shippingMethod : shippingMethod}
            shippingAddress={locked ? active.shippingAddress : shippingAddress}
            foxpostLockerId={locked ? active.foxpostLockerId || active.foxpostLocker?.place_id : foxpostLocker?.place_id}
            recipientPhone={locked ? active.recipientPhone : recipientPhone}
            checkout={checkout}
            recovery={{ quote: displayedQuote, shippingMethod, recipientName: user.name, recipientEmail: user.email,
              ...(shippingMethod === "foxpost" ? { foxpostLocker, recipientPhone,
                shippingAddress: foxpostLocker && { address: foxpostLocker.street, city: foxpostLocker.city, postalCode: foxpostLocker.postalCode, country: foxpostLocker.country } } : { shippingAddress }) }}
            onPaymentError={onPaymentError}
            disabled={checkout.cancelling || pending || (active?.status === "READY" ? !active.quote : buttonDisabled)}
          />
        </Box>
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
