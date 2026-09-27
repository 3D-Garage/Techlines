import {
  Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Heading, Select,
  Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr,
} from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link as ReactLink, Navigate, useLocation } from "react-router-dom";
import { customOrderError, customOrderStatuses, formatOrderDate } from "../utils/customOrders";

export const CustomOrderStatus = ({ status }) => {
  const display = customOrderStatuses[status];
  return <Badge colorScheme={display?.color || "gray"}>{display?.label || status}</Badge>;
};

const AdminCustomOrdersScreen = () => {
  const { userInfo } = useSelector((state) => state.user);
  const location = useLocation();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ orders: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const token = userInfo?.isAdmin === true ? userInfo.token : null;

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let needsPageRefresh = false;
    setLoading(true);
    setError("");
    axios.get("/api/custom-orders", {
      headers: { Authorization: `Bearer ${token}` },
      params: { page, ...(status ? { status } : {}) }, signal: controller.signal,
    }).then(({ data }) => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, data.pages);
      if (page > lastPage) {
        needsPageRefresh = true;
        setPage(lastPage);
      } else setResult(data);
    })
      .catch((requestError) => { if (!controller.signal.aborted) setError(customOrderError(requestError, "A kérések betöltése nem sikerült.")); })
      .finally(() => { if (!controller.signal.aborted && !needsPageRefresh) setLoading(false); });
    return () => controller.abort();
  }, [token, page, status, attempt]);

  if (!userInfo) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!token) return <Box maxW="3xl" mx="auto" p="8" minH="80vh"><Alert status="error"><AlertIcon />A megtekintéshez adminisztrátori jogosultság szükséges.</Alert><Button as={ReactLink} to="/products" mt="4">Vissza a termékekhez</Button></Box>;

  return (
    <Box minH="80vh" maxW="8xl" mx="auto" px={{ base: 4, md: 8 }} py="10">
      <Button as={ReactLink} to="/admin-console" variant="link" colorScheme="purple" mb="6">Vissza az adminisztrációhoz</Button>
      <Heading size="lg" mb="6">Egyedi megrendelések</Heading>
      <Flex gap="4" align="end" justify="space-between" mb="6" flexWrap="wrap">
        <FormControl maxW="sm">
          <FormLabel htmlFor="custom-order-status-filter">Állapot szerinti szűrés</FormLabel>
          <Select id="custom-order-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} focusBorderColor="purple.500">
            <option value="">Minden állapot</option>
            {Object.entries(customOrderStatuses).map(([value, display]) => <option key={value} value={value}>{display.label}</option>)}
          </Select>
        </FormControl>
        <Button variant="outline" colorScheme="purple" isDisabled={loading} onClick={() => setAttempt((current) => current + 1)}>Frissítés</Button>
      </Flex>
      {error && <Alert status="error" mb="4"><AlertIcon />{error}</Alert>}
      {loading ? <Spinner label="Kérések betöltése" color="purple.500" /> : !error && (
        <>
          <Text mb="4">Összesen {result.total} kérés</Text>
          {result.orders.length === 0 ? <Text>Még nincs a szűrésnek megfelelő kérés.</Text> : (
            <TableContainer><Table size="sm"><Thead><Tr>
              <Th>Beérkezés</Th><Th>Ügyfél</Th><Th>Állapot</Th><Th>Modellfájl</Th><Th>Értesítés</Th><Th>Kérés</Th>
            </Tr></Thead><Tbody>{result.orders.map((order) => <Tr key={order._id}>
              <Td>{formatOrderDate(order.createdAt)}</Td>
              <Td><Text>{order.customerName}</Text><Text fontSize="xs">{order.customerEmail}</Text><Text fontSize="xs">{order.customerPhone}</Text></Td>
              <Td><CustomOrderStatus status={order.status} /></Td>
              <Td>{order.modelFile ? "Csatolva" : "Nincs"}</Td>
              <Td>{order.notification?.status === "failed" ? <Badge colorScheme="red">Sikertelen</Badge> : order.notification?.status === "sent" ? "Elküldve" : "Függőben"}</Td>
              <Td><Button as={ReactLink} to={`/admin/custom-orders/${order._id}`} variant="outline" size="sm" colorScheme="purple">Részletek</Button><Text mt="1" fontSize="xs">{order._id}</Text></Td>
            </Tr>)}</Tbody></Table></TableContainer>
          )}
          {result.pages > 1 && <Flex mt="6" gap="4" align="center">
            <Button isDisabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Előző</Button>
            <Text>{page}. / {result.pages}. oldal</Text>
            <Button isDisabled={page >= result.pages} onClick={() => setPage((current) => current + 1)}>Következő</Button>
          </Flex>}
        </>
      )}
    </Box>
  );
};

export default AdminCustomOrdersScreen;
