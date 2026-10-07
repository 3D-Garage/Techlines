import { Alert, AlertIcon, Box, Button, Flex, FormControl, FormHelperText, FormLabel, Heading, Input, Radio, RadioGroup, Stack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectShippingMethod } from "../redux/actions/cartAction";
import { setShippingAdress, getShippingAddressError } from "../redux/actions/orderAction";
import { setFoxpostDetails } from "../redux/slices/order";
import { normalizeRecipientPhone, readShippingDraft, shippingDraftKey } from "../utils/shipping";
import FoxpostLockerPicker from "./FoxpostLockerPicker";

const ShippingInformation = ({ lockedCheckout, recoveryId }) => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.user.userInfo);
  const selectedMethod = useSelector((state) => state.cart.shippingMethod);
  const [draft] = useState(() => readShippingDraft(user._id));
  const [address, setAddress] = useState(draft.shippingAddress || { address: "", postalCode: "", city: "", country: "HU" });
  const [phone, setPhone] = useState(draft.recipientPhone || "");
  const [locker, setLocker] = useState(draft.foxpostLocker || null);
  const [lockers, setLockers] = useState(null);
  const [listError, setListError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const shippingMethod = lockedCheckout?.shippingMethod || lockedCheckout?.quote?.shippingMethod || lockedCheckout?.payload?.shippingMethod || selectedMethod;
  const displayedAddress = lockedCheckout?.shippingAddress || lockedCheckout?.payload?.shippingAddress || address;
  const lockedLockerId = lockedCheckout?.foxpostLockerId || lockedCheckout?.payload?.foxpostLockerId;
  const displayedLocker = lockedCheckout ? lockedCheckout.foxpostLocker || (locker?.place_id === String(lockedLockerId) ? locker : null) : locker;
  const displayedPhone = lockedCheckout?.recipientPhone || lockedCheckout?.payload?.recipientPhone || phone;

  useEffect(() => {
    dispatch(selectShippingMethod(draft.shippingMethod || "standard"));
  }, [draft, dispatch]);

  useEffect(() => {
    if (lockedCheckout || shippingMethod !== "foxpost") return;
    const controller = new AbortController();
    let mounted = true;
    setLockers(null);
    setListError("");
    dispatch(setFoxpostDetails({ foxpostListReady: false }));
    (async () => {
      try {
        const response = await fetch("/api/shipping/foxpost/lockers", { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.lockers)) throw new Error(data.message || "Az automatalista nem tölthető be.");
        if (mounted) setLockers(data.lockers);
      } catch (error) {
        if (mounted) setListError(error.message || "Az automatalista nem tölthető be.");
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, [shippingMethod, lockedCheckout, retry, dispatch, recoveryId]);

  useEffect(() => {
    if (lockedCheckout) return;
    const officialLocker = lockers?.find((point) => point.place_id === locker?.place_id);
    dispatch(setShippingAdress(address));
    dispatch(setFoxpostDetails({ recipientPhone: phone, foxpostLocker: officialLocker || locker, foxpostListReady: Boolean(officialLocker) }));
    const complete = shippingMethod === "foxpost" ? officialLocker && normalizeRecipientPhone(phone) :
      address.address.trim().length >= 2 && address.city.trim().length >= 2 && /^[A-Za-z]{2}$/.test(address.country.trim()) &&
      (address.country.trim().toUpperCase() === "HU" ? /^\d{4}$/.test(address.postalCode.trim()) : address.postalCode.trim().length >= 2);
    dispatch(getShippingAddressError(complete ? null : shippingMethod === "foxpost" ? "Válassz elérhető automatát és adj meg magyar mobiltelefonszámot." : "Please complete the shipping address."));
    localStorage.setItem(shippingDraftKey(user._id), JSON.stringify({ shippingMethod, shippingAddress: address, recipientPhone: phone, foxpostLocker: officialLocker || locker }));
  }, [address, phone, locker, lockers, shippingMethod, dispatch, lockedCheckout, user._id]);

  const update = (event) => setAddress((current) => ({ ...current, [event.target.name]: event.target.value }));
  return <Stack spacing="8">
    {lockedCheckout && <Text>The prepared payment uses these saved shipping details. Changes to your cart are kept for a later purchase.</Text>}
    <Box>
      <Heading fontSize="2xl" mb="5">Shipping Method</Heading>
      <RadioGroup value={shippingMethod} isDisabled={Boolean(lockedCheckout)} onChange={(value) => { setPickerOpen(false); dispatch(selectShippingMethod(value)); }}>
        <Stack direction={{ base: "column", xl: "row" }} spacing="6">
          <Radio value="standard" colorScheme="purple"><Text fontWeight="bold">Standard 1,490 Ft</Text><Text fontSize="sm">10 000 Ft termékösszegtől ingyenes.</Text></Radio>
          <Radio value="express" colorScheme="purple"><Text fontWeight="bold">Express 3,990 Ft</Text><Text fontSize="sm">Dispatched within 24 hours.</Text></Radio>
          <Radio value="foxpost" colorScheme="purple"><Text fontWeight="bold">FOXPOST csomagautomata</Text><Text fontSize="sm">1 490 Ft; 10 000 Ft termékösszegtől ingyenes.</Text></Radio>
        </Stack>
      </RadioGroup>
    </Box>
    {shippingMethod === "foxpost" ? <Stack spacing="5">
      <Box><Text fontWeight="bold">Címzett: {lockedCheckout?.recipientName || user.name}</Text><Text>E-mail: {lockedCheckout?.recipientEmail || user.email}</Text></Box>
      <FormControl isRequired isDisabled={Boolean(lockedCheckout)} isInvalid={Boolean(displayedPhone) && !normalizeRecipientPhone(displayedPhone)}>
        <FormLabel>Magyar mobiltelefonszám</FormLabel>
        <Input name="recipientPhone" type="tel" autoComplete="tel" value={displayedPhone} onChange={(event) => setPhone(event.target.value)} placeholder="+36 30 123 4567" />
        <FormHelperText>Az átvételhez szükséges értesítést erre a számra küldik.</FormHelperText>
        {Boolean(displayedPhone) && !normalizeRecipientPhone(displayedPhone) && <Text color="red.500">Adj meg érvényes magyar mobiltelefonszámot.</Text>}
      </FormControl>
      {displayedLocker && <Box borderWidth="1px" rounded="md" p="4"><Text fontWeight="bold">{displayedLocker.name}</Text><Text>{displayedLocker.address}</Text></Box>}
      {lockedCheckout && !displayedLocker && <Text>Mentett automataazonosító: {lockedCheckout.foxpostLockerId || lockedCheckout.payload?.foxpostLockerId}</Text>}
      {!lockedCheckout && <>
        {listError && <Alert status="error"><AlertIcon />{listError}</Alert>}
        {listError && <Button onClick={() => setRetry((value) => value + 1)}>Automatalista újratöltése</Button>}
        {lockers && locker && !lockers.some((point) => point.place_id === locker.place_id) && <Alert status="warning"><AlertIcon />A korábbi automata jelenleg nem választható. Válassz másik automatát.</Alert>}
        <Button colorScheme="purple" isDisabled={!lockers} isLoading={!lockers && !listError} onClick={() => setPickerOpen(true)}>{locker ? "Másik automata választása" : "Automata választása"}</Button>
        <FoxpostLockerPicker isOpen={pickerOpen} onClose={() => setPickerOpen(false)} lockers={lockers || []} onSelect={(point) => { setLocker(point); setPickerOpen(false); }} />
      </>}
    </Stack> : <>
      <FormControl isRequired isDisabled={Boolean(lockedCheckout)}><FormLabel>Street address</FormLabel><Input name="address" value={displayedAddress.address} onChange={update} placeholder="Street and house number" focusBorderColor="purple.500" /></FormControl>
      <Flex gap="4" direction={{ base: "column", sm: "row" }}>
        <FormControl isRequired isDisabled={Boolean(lockedCheckout)}><FormLabel>Postal code</FormLabel><Input name="postalCode" value={displayedAddress.postalCode} onChange={update} placeholder="Postal code" focusBorderColor="purple.500" /></FormControl>
        <FormControl isRequired isDisabled={Boolean(lockedCheckout)}><FormLabel>City</FormLabel><Input name="city" value={displayedAddress.city} onChange={update} placeholder="City" focusBorderColor="purple.500" /></FormControl>
      </Flex>
      <FormControl isRequired isDisabled={Boolean(lockedCheckout)}><FormLabel>Country</FormLabel><Input name="country" value={displayedAddress.country} onChange={update} placeholder="Country code (HU)" maxLength={2} focusBorderColor="purple.500" /></FormControl>
    </>}
  </Stack>;
};
export default ShippingInformation;
