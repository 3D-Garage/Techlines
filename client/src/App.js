import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProductsScreen from "./screens/ProductsScreen";
import CartScreen from "./screens/CartScreen";
import ProductScreen from "./screens/ProductScreen";
import Footer from "./components/Footer";
import Home from "./screens/LandingScreen";
import LoginScreen from "./screens/LoginScreen";
import RegistraionScreen from "./screens/RegistraionScreen";
import ProfileScreen from "./screens/ProfileScreen";
import CheckOutScreen from "./screens/CheckOutScreen";
import YourOrdersScreen from "./screens/YourOrdersScreen";
import AdminConsoleScreen from "./screens/AdminConsoleScreen";
import OrderSuccessScreen from "./screens/OrderSuccessScreen";
import CustomOrderScreen from "./screens/CustomOrderScreen";
import AdminCustomOrdersScreen from "./screens/AdminCustomOrdersScreen";
import AdminCustomOrderScreen from "./screens/AdminCustomOrderScreen";

function App() {
  return (
    <ChakraProvider>
      <Router>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />}></Route>
            <Route path="/product/:id" element={<ProductScreen />}></Route>
            <Route path="/products" element={<ProductsScreen />}></Route>
            <Route path="/custom-order" element={<CustomOrderScreen />}></Route>
            <Route path="/cart" element={<CartScreen />}></Route>
            <Route path="/login" element={<LoginScreen />}></Route>
            <Route path="/registration" element={<RegistraionScreen />}></Route>
            <Route path="/profile" element={<ProfileScreen />}></Route>
            <Route path="/checkout" element={<CheckOutScreen />}></Route>
            <Route path="/your-orders" element={<YourOrdersScreen />}></Route>
            <Route path="/admin-console" element={<AdminConsoleScreen />}></Route>
            <Route path="/admin/custom-orders" element={<AdminCustomOrdersScreen />}></Route>
            <Route path="/admin/custom-orders/:id" element={<AdminCustomOrderScreen />}></Route>
            <Route path="/order-success" element={<OrderSuccessScreen />}></Route>
          </Routes>
        </main>
        <Footer />
      </Router>
    </ChakraProvider>
  );
}

export default App;
