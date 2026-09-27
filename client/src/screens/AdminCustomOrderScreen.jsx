import {
  Alert, AlertIcon, Box, Button, Divider, FormControl, FormErrorMessage, FormLabel, Heading,
  Select, SimpleGrid, Spinner, Stack, Text, Textarea, useToast,
} from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link as ReactLink, Navigate, useLocation, useParams } from "react-router-dom";
import { CustomOrderStatus } from "./AdminCustomOrdersScreen";
import { customOrderError, customOrderStatuses, formatFileSize, formatOrderDate } from "../utils/customOrders";

const Detail = ({ label, children }) => <Box><Text fontWeight="semibold" mb="1">{label}</Text><Text whiteSpace="pre-wrap" overflowWrap="anywhere">{children || "—"}</Text></Box>;

const AdminCustomOrderScreen = () => {
  const { id } = useParams();
  const { userInfo } = useSelector((state) => state.user);
  const location = useLocation();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("new");
  const [adminNotes, setAdminNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  const savingRef = useRef(false);
  const token = userInfo?.isAdmin === true ? userInfo.token : null;

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setOrder(null);
    axios.get(`/api/custom-orders/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) { setOrder(data); setStatus(data.status); setAdminNotes(data.adminNotes || ""); }
      })
      .catch((requestError) => { if (!controller.signal.aborted) setError(customOrderError(requestError, "A kérés betöltése nem sikerült.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, token, attempt]);

  if (!userInfo) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!token) return <Box maxW="3xl" mx="auto" p="8" minH="80vh"><Alert status="error"><AlertIcon />A megtekintéshez adminisztrátori jogosultság szükséges.</Alert><Button as={ReactLink} to="/products" mt="4">Vissza a termékekhez</Button></Box>;

  const save = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setFieldErrors({});
    try {
      const { data } = await axios.patch(`/api/custom-orders/${id}/status`, { status, adminNotes }, { headers: { Authorization: `Bearer ${token}` } });
      setOrder(data);
      setStatus(data.status);
      setAdminNotes(data.adminNotes || "");
      toast({ description: "Az állapot és a belső megjegyzés mentve.", status: "success", isClosable: true });
    } catch (requestError) {
      setSaveError(customOrderError(requestError, "A módosítások mentése nem sikerült."));
      const errors = requestError.response?.data?.errors;
      if (errors && typeof errors === "object") setFieldErrors(Object.fromEntries(Object.entries(errors).filter(([, value]) => typeof value === "string")));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const { data } = await axios.get(`/api/custom-orders/${id}/file`, { headers: { Authorization: `Bearer ${token}` }, responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = order.modelFile.originalName || `model${order.modelFile.extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_error) {
      setDownloadError("A modellfájl letöltése nem sikerült. Próbáld újra később.");
    } finally { setDownloading(false); }
  };

  return (
    <Box minH="80vh" maxW="5xl" mx="auto" px={{ base: 4, md: 8 }} py="10">
      <Button as={ReactLink} to="/admin/custom-orders" variant="link" colorScheme="purple" mb="6">Vissza az egyedi megrendelésekhez</Button>
      <Heading size="lg" mb="6">Egyedi kérés részletei</Heading>
      {loading && <Spinner label="Kérés betöltése" color="purple.500" />}
      {error && <Stack><Alert status="error"><AlertIcon />{error}</Alert><Button alignSelf="start" onClick={() => setAttempt((current) => current + 1)}>Újrapróbálás</Button></Stack>}
      {order && <Stack spacing="6">
        <Box><Text fontSize="sm" mb="2" overflowWrap="anywhere">Azonosító: {order._id}</Text><CustomOrderStatus status={order.status} /></Box>
        {order.notification?.status === "failed" && <Alert status="warning"><AlertIcon />Az e-mail-értesítés küldése nem sikerült. A kérés biztonságosan rögzítve van.</Alert>}
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing="6">
          <Detail label="Ügyfél neve">{order.customerName}</Detail>
          <Detail label="E-mail-cím">{order.customerEmail}</Detail>
          <Detail label="Telefonszám">{order.customerPhone}</Detail>
          <Detail label="E-mail-értesítés">{order.notification?.status === "sent" ? "Elküldve" : order.notification?.status === "failed" ? "Sikertelen" : "Függőben"}</Detail>
          <Detail label="Létrehozva">{formatOrderDate(order.createdAt)}</Detail>
          <Detail label="Utolsó módosítás">{formatOrderDate(order.updatedAt)}</Detail>
        </SimpleGrid>
        <Divider />
        <Detail label="Projekt leírása">{order.description}</Detail>
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing="6">
          <Detail label="Anyag">{order.material}</Detail>
          <Detail label="Méretek">{order.dimensions}</Detail>
          <Detail label="Darabszám">{order.quantity}</Detail>
        </SimpleGrid>
        <Box>
          <Heading as="h2" size="sm" mb="2">Modellfájl</Heading>
          {order.modelFile ? <Stack align="start" spacing="2">
            <Text overflowWrap="anywhere">{order.modelFile.originalName}</Text>
            <Text fontSize="sm">{formatFileSize(order.modelFile.size)} · {order.modelFile.extension} · {order.modelFile.mimeType}</Text>
            <Button colorScheme="purple" variant="outline" onClick={download} isLoading={downloading} loadingText="Letöltés…">Modellfájl letöltése</Button>
            {downloadError && <Alert status="error"><AlertIcon />{downloadError}</Alert>}
          </Stack> : <Text>Nincs csatolt modellfájl.</Text>}
        </Box>
        <Divider />
        <Stack as="form" onSubmit={save} spacing="5">
          <Heading as="h2" size="md">Kérés kezelése</Heading>
          {saveError && <Alert status="error"><AlertIcon />{saveError}</Alert>}
          <FormControl isInvalid={Boolean(fieldErrors.status)} isDisabled={saving} maxW="sm">
            <FormLabel htmlFor="custom-order-status">Állapot</FormLabel>
            <Select id="custom-order-status" value={status} onChange={(event) => setStatus(event.target.value)} focusBorderColor="purple.500">
              {Object.entries(customOrderStatuses).map(([value, display]) => <option key={value} value={value}>{display.label}</option>)}
            </Select>
            <FormErrorMessage>{fieldErrors.status}</FormErrorMessage>
          </FormControl>
          <FormControl isInvalid={Boolean(fieldErrors.adminNotes)} isDisabled={saving}>
            <FormLabel htmlFor="adminNotes">Belső megjegyzés (csak adminisztrátoroknak)</FormLabel>
            <Textarea id="adminNotes" name="adminNotes" rows={6} maxLength={10000} value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} focusBorderColor="purple.500" />
            <FormErrorMessage>{fieldErrors.adminNotes}</FormErrorMessage>
          </FormControl>
          <Button type="submit" alignSelf="start" colorScheme="purple" isLoading={saving} loadingText="Mentés…">Módosítások mentése</Button>
        </Stack>
      </Stack>}
    </Box>
  );
};

export default AdminCustomOrderScreen;
