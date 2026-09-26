import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar.jsx";
import ProductsScreen from "./screens/ProductsScreen.jsx";
import CartScreen from "./screens/CartScreen.jsx";
import ProductScreen from "./screens/ProductScreen.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./screens/LandingScreen.jsx";
import LoginScreen from "./screens/LoginScreen.jsx";
import RegistraionScreen from "./screens/RegistraionScreen.jsx";
import ProfileScreen from "./screens/ProfileScreen.jsx";
import CheckOutScreen from "./screens/CheckOutScreen.jsx";
import YourOrdersScreen from "./screens/YourOrdersScreen.jsx";
import AdminConsoleScreen from "./screens/AdminConsoleScreen.jsx";
import OrderSuccessScreen from "./screens/OrderSuccessScreen.jsx";

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
            <Route path="/cart" element={<CartScreen />}></Route>
            <Route path="/login" element={<LoginScreen />}></Route>
            <Route path="/registration" element={<RegistraionScreen />}></Route>
            <Route path="/profile" element={<ProfileScreen />}></Route>
            <Route path="/checkout" element={<CheckOutScreen />}></Route>
            <Route path="/your-orders" element={<YourOrdersScreen />}></Route>
            <Route path="/admin-console" element={<AdminConsoleScreen />}></Route>
            <Route path="/order-success" element={<OrderSuccessScreen />}></Route>
          </Routes>
        </main>
        <Footer />
      </Router>
    </ChakraProvider>
  );
}

export default App;
