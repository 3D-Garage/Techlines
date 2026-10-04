import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, FormControl, FormLabel, Heading, Input,
  Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay,
  Spinner, Tab, TabList, TabPanel, TabPanels, Table, TableContainer, Tabs, Tbody, Td, Text,
  Textarea, Th, Thead, Tr, useDisclosure, useToast,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link as ReactLink, Navigate, useLocation } from "react-router-dom";
import { getProducts } from "../redux/actions/productAction";
import axios from "axios";
import {
  createAdminProduct, deleteAdminProduct, deleteOrder, deleteUser, getAllOrders, getAllUsers,
  removeReview, setDelivered, updateAdminProduct,
} from "../redux/actions/adminActions";

const emptyProduct = { name: "", image: "", brand: "", category: "", description: "", price: "", stock: "", productIsNew: false };

const AdminConsoleScreen = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const toast = useToast();
  const modal = useDisclosure();
  const { userInfo } = useSelector((state) => state.user);
  const { users, orders, loading, error } = useSelector((state) => state.admin);
  const { products } = useSelector((state) => state.products);
  const [form, setForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [paymentError, setPaymentError] = useState("");
  const loadPending = async () => {
    try {
      const { data } = await axios.get("/api/checkout/admin/pending", { headers: { Authorization: `Bearer ${userInfo.token}` } });
      setPendingPayments(data);
      setPaymentError("");
    } catch (_error) { setPaymentError("A függő fizetések nem kérdezhetők le."); }
  };
  useEffect(() => {
    if (!userInfo?.isAdmin) return;
    const load = async () => {
      try {
        const { data } = await axios.get("/api/checkout/admin/pending", { headers: { Authorization: `Bearer ${userInfo.token}` } });
        setPendingPayments(data);
      } catch (_error) { setPaymentError("A függő fizetések nem kérdezhetők le."); }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [userInfo]);
  const reconcilePayment = async (id) => {
    try {
      await axios.post(`/api/checkout/${id}/reconcile`, {}, { headers: { Authorization: `Bearer ${userInfo.token}` } });
      await loadPending();
      dispatch(getAllOrders());
    } catch (_error) { setPaymentError("A fizetés újraellenőrzése nem sikerült."); }
  };

  useEffect(() => {
    if (userInfo?.isAdmin === true) {
      dispatch(getAllUsers());
      dispatch(getAllOrders());
      dispatch(getProducts());
    }
  }, [dispatch, userInfo]);

  const reviews = useMemo(() => products.flatMap((product) =>
    (product.reviews || []).map((review) => ({ ...review, productId: product._id, productName: product.name }))
  ), [products]);

  if (!userInfo || userInfo.isAdmin !== true) return <Navigate to="/login" replace state={{ from: location }} />;

  const run = async (action, success) => {
    try { await dispatch(action); toast({ description: success, status: "success", isClosable: true }); }
    catch (_error) { toast({ description: "The operation could not be completed.", status: "error", isClosable: true }); }
  };

  const askAndRun = (message, action, success) => {
    if (window.confirm(message)) run(action, success);
  };

  const openNewProduct = () => { setEditingId(null); setForm(emptyProduct); modal.onOpen(); };
  const openEditProduct = (product) => {
    setEditingId(product._id);
    setForm({ name: product.name, image: product.image, brand: product.brand, category: product.category, description: product.description, price: product.price, stock: product.stock, productIsNew: product.productIsNew, inventoryVersion: product.inventoryVersion ?? 0 });
    modal.onOpen();
  };
  const updateField = (event) => {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };
  const saveProduct = async () => {
    const action = editingId ? updateAdminProduct(editingId, form) : createAdminProduct(form);
    await run(action, editingId ? "Product updated." : "Product created.");
    modal.onClose();
  };

  return (
    <Box minH="100vh" maxW="8xl" mx="auto" px={{ base: 4, md: 8 }} py="10">
      <Heading fontSize="2xl" mb="6">3D Garage Admin Console</Heading>
      <Button as={ReactLink} to="/admin/custom-orders" colorScheme="purple" mb="6">Egyedi megrendelések</Button>
      {error && <Alert status="error" mb="4"><AlertIcon />{error}</Alert>}
      {loading && <Spinner color="purple.500" mb="4" />}
      <Tabs colorScheme="purple" variant="enclosed" isLazy>
        <TabList overflowX="auto"><Tab>Users</Tab><Tab>Products</Tab><Tab>Reviews</Tab><Tab>Orders</Tab><Tab>Függő fizetések</Tab></TabList>
        <TabPanels>
          <TabPanel px="0">
            <TableContainer><Table size="sm"><Thead><Tr><Th>Name</Th><Th>Email</Th><Th>Registered</Th><Th>Role</Th><Th /></Tr></Thead>
              <Tbody>{users.map((user) => <Tr key={user._id}>
                <Td>{user.name}{user._id === userInfo._id ? " (You)" : ""}</Td><Td>{user.email}</Td>
                <Td>{new Date(user.createdAt).toLocaleDateString()}</Td><Td><Badge colorScheme={user.isAdmin ? "purple" : "gray"}>{user.isAdmin ? "Admin" : "Customer"}</Badge></Td>
                <Td><Button size="xs" colorScheme="red" variant="outline" isDisabled={user._id === userInfo._id} onClick={() => askAndRun(`Remove ${user.name}?`, deleteUser(user._id), "User removed.")}>Remove</Button></Td>
              </Tr>)}</Tbody>
            </Table></TableContainer>
          </TabPanel>
          <TabPanel px="0">
            <Button colorScheme="purple" mb="4" onClick={openNewProduct}>Add product</Button>
            <TableContainer><Table size="sm"><Thead><Tr><Th>Product</Th><Th>Brand</Th><Th>Category</Th><Th isNumeric>Price</Th><Th isNumeric>Stock</Th><Th /></Tr></Thead>
              <Tbody>{products.map((product) => <Tr key={product._id}>
                <Td>{product.name}</Td><Td>{product.brand}</Td><Td>{product.category}</Td><Td isNumeric>{Number(product.price).toLocaleString("hu-HU")} Ft</Td><Td isNumeric>{product.stock}</Td>
                <Td><Button size="xs" mr="2" colorScheme="purple" variant="outline" onClick={() => openEditProduct(product)}>Edit</Button><Button size="xs" colorScheme="red" variant="outline" onClick={() => askAndRun(`Remove ${product.name}?`, deleteAdminProduct(product._id), "Product removed.")}>Remove</Button></Td>
              </Tr>)}</Tbody>
            </Table></TableContainer>
          </TabPanel>
          <TabPanel px="0">
            {reviews.length === 0 ? <Text>No reviews yet.</Text> : <TableContainer><Table size="sm"><Thead><Tr><Th>Product</Th><Th>Customer</Th><Th>Rating</Th><Th>Review</Th><Th /></Tr></Thead>
              <Tbody>{reviews.map((review) => <Tr key={review._id}><Td>{review.productName}</Td><Td>{review.name}</Td><Td>{review.rating}/5</Td><Td maxW="sm" whiteSpace="normal"><Text fontWeight="bold">{review.title}</Text>{review.comment}</Td>
                <Td><Button size="xs" colorScheme="red" variant="outline" onClick={() => askAndRun("Remove this review?", removeReview(review.productId, review._id), "Review removed.")}>Remove</Button></Td></Tr>)}</Tbody>
            </Table></TableContainer>}
          </TabPanel>
          <TabPanel px="0">
            <TableContainer><Table size="sm"><Thead><Tr><Th>Date</Th><Th>Customer</Th><Th>Address</Th><Th>Items</Th><Th isNumeric>Total</Th><Th>Status</Th><Th /></Tr></Thead>
              <Tbody>{orders.map((order) => <Tr key={order._id}>
                <Td>{new Date(order.createdAt).toLocaleDateString()}</Td><Td>{order.username}<br /><Text fontSize="xs">{order.email}</Text></Td>
                <Td>{order.shippingAddress.address}, {order.shippingAddress.postalCode} {order.shippingAddress.city}, {order.shippingAddress.country}</Td>
                <Td>{order.orderItems.map((item) => <Text key={item._id}>{item.qty} × {item.name}</Text>)}</Td><Td isNumeric>{Number(order.totalPrice).toLocaleString("hu-HU")} Ft</Td>
                <Td><Badge colorScheme={order.isDelivered ? "green" : "purple"}>{order.isDelivered ? "Delivered" : "Processing"}</Badge></Td>
                <Td>{!order.isDelivered && <Button size="xs" colorScheme="purple" mr="2" isDisabled={order.paymentStatus !== "COMPLETED" || !order.checkoutId} onClick={() => run(setDelivered(order._id), "Order marked delivered.")}>Delivered</Button>}<Button size="xs" colorScheme="red" variant="outline" onClick={() => askAndRun("Archive this order?", deleteOrder(order._id), "Order archived.")}>Archive</Button></Td>
              </Tr>)}</Tbody>
            </Table></TableContainer>
          </TabPanel>
          <TabPanel px="0">
            {paymentError && <Alert status="error"><AlertIcon />{paymentError}</Alert>}
            <Button onClick={loadPending} mb="4">Frissítés</Button>
            <TableContainer><Table size="sm"><Thead><Tr><Th>Checkout</Th><Th>PayPal</Th><Th>Állapot</Th><Th>Foglalás</Th><Th>Probléma</Th><Th /></Tr></Thead>
              <Tbody>{pendingPayments.map((payment) => <Tr key={payment._id}>
                <Td>{payment._id}</Td><Td>{payment.paypalOrderId}</Td><Td>{payment.status}</Td><Td>{payment.reservation}</Td><Td>{payment.issue}</Td>
                <Td><Button size="xs" onClick={() => reconcilePayment(payment._id)}>Újraellenőrzés</Button></Td>
              </Tr>)}</Tbody>
            </Table></TableContainer>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Modal isOpen={modal.isOpen} onClose={modal.onClose} size="xl">
        <ModalOverlay /><ModalContent><ModalHeader>{editingId ? "Edit product" : "Add product"}</ModalHeader><ModalCloseButton />
          <ModalBody>{[
            ["name", "Name"], ["image", "Image URL"], ["brand", "Brand"], ["category", "Category"], ["price", "Price (Ft)"], ["stock", "Stock"],
          ].map(([name, label]) => <FormControl key={name} mb="3" isRequired><FormLabel>{label}</FormLabel><Input name={name} value={form[name]} onChange={updateField} focusBorderColor="purple.500" type={name === "price" || name === "stock" ? "number" : "text"} /></FormControl>)}
            <FormControl mb="3" isRequired><FormLabel>Description</FormLabel><Textarea name="description" value={form.description} onChange={updateField} focusBorderColor="purple.500" /></FormControl>
            <Checkbox name="productIsNew" isChecked={form.productIsNew} onChange={updateField} colorScheme="purple">New product badge</Checkbox>
          </ModalBody><ModalFooter><Button variant="ghost" mr="3" onClick={modal.onClose}>Cancel</Button><Button colorScheme="purple" onClick={saveProduct}>Save</Button></ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default AdminConsoleScreen;
