import { Alert, AlertDescription, AlertIcon, AlertTitle, Badge, Box, Button, ListItem, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, UnorderedList } from "@chakra-ui/react";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation } from "react-router-dom";
import { getUserOrders } from "../redux/actions/userActions";

const YourOrdersScreen = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { loading, error, orders, userInfo } = useSelector((state) => state.user);

  useEffect(() => { if (userInfo) dispatch(getUserOrders()); }, [dispatch, userInfo]);

  if (!userInfo) return <Navigate to="/login" replace state={{ from: location }} />;
  if (loading) return <Box minH="100vh" textAlign="center" pt="20"><Spinner color="purple.500" size="xl" /></Box>;
  if (error) return <Alert status="error"><AlertIcon /><AlertTitle>Something went wrong.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;

  return (
    <Box minH="100vh" maxW="7xl" mx="auto" px={{ base: 4, md: 8 }} py="10">
      <Text fontSize="2xl" fontWeight="extrabold" mb="6">Your Orders</Text>
      {orders.length === 0 ? <Alert status="info"><AlertIcon />You have not placed an order yet.</Alert> : (
        <TableContainer borderWidth="1px" rounded="xl">
          <Table variant="simple">
            <Thead><Tr><Th>Order</Th><Th>Date</Th><Th>Items</Th><Th>Total</Th><Th>Delivery</Th><Th /></Tr></Thead>
            <Tbody>{orders.map((order) => (
              <Tr key={order._id}>
                <Td fontFamily="mono" fontSize="xs">{order._id}</Td>
                <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                <Td><UnorderedList>{order.orderItems.map((item) => <ListItem key={item._id}>{item.qty} × {item.name}</ListItem>)}</UnorderedList></Td>
                <Td>{Number(order.totalPrice).toLocaleString("hu-HU")} Ft</Td>
                <Td><Badge colorScheme={order.isDelivered ? "green" : "purple"}>{order.isDelivered ? "Delivered" : "Processing"}</Badge></Td>
                <Td><Button size="sm" variant="outline" colorScheme="purple" onClick={() => window.print()}>Print</Button></Td>
              </Tr>
            ))}</Tbody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default YourOrdersScreen;
