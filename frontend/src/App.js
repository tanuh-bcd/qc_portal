import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AdminPage from './pages/AdminPage';
import RadiologistPage from './pages/RadiologistPage';
import Footer from './components/Footer';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';


const LoadingFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
    Loading...
  </div>
);

const PublicLayout = () => (
  <>
    <Navbar />
    <div className="main-content" style={{ paddingTop: '60px' }}>
      <Outlet />
    </div>
  </>
);

function App() {
  return (
    <Router>
      <div className="App" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Public pages with Navbar — no login required */}
            <Route path="/qc" element={<PublicLayout />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
            </Route>
            {/* Auth-protected pages — no Navbar */}
            <Route path="/qc/admin" element={<AdminPage />} />
            <Route path="/qc/radiologist" element={<RadiologistPage />} />
          </Routes>
        </Suspense>
        <Footer />
        <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
      </div>
    </Router>
  );
}

export default App;
