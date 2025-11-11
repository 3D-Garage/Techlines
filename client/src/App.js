// App root: sets up Chakra UI provider, router, and top-level routes
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
          </Routes>
        </main>
        <Footer />
      </Router>
    </ChakraProvider>
  );
}

export default App;
