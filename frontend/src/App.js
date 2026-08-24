import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AdminPage from './pages/AdminPage';
import PatientPage from './pages/PatientPage';
import DoctorPage from './pages/DoctorPage';
import PublicQuestionnairePage from './pages/PublicQuestionnairePage';
import Footer from './components/Footer';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import QcLogin from './components/QualityCheck/QcLogin';
import QCAdminDashboard from './components/QualityCheck/QCAdminDashboard';
import QcRadiologistSubjects from './components/QualityCheck/QcRadiologistSubjects';

const Stats = lazy(() => import('./components/Stats'));
const Demo = lazy(() => import('./components/Demo'));

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
            <Route path="/" element={<PublicLayout />}>
              <Route index element={<PublicQuestionnairePage />} />
              <Route path="demo" element={<Demo />} />
              <Route path="stats" element={<Stats />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route path="qc-bcd-login" element={<QcLogin />} />
            </Route>
            {/* Auth-protected pages — no Navbar */}
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/patient" element={<PatientPage />} />
            <Route path="/doctor" element={<DoctorPage />} />
            <Route path="/quality-check/dashboard" element={<QCAdminDashboard />} />
           <Route path="/qc-radiologist/dashboard" element={<QcRadiologistSubjects />} />
          </Routes>
        </Suspense>
        <Footer />
        <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
      </div>
    </Router>
  );
}

export default App;
