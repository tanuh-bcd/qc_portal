import React from 'react';
import { LogOut } from 'lucide-react';

const Layout = ({ children, userRole, handleLogout, maxWidth = '1200px', padding = '20px', fullWidth = false }) => {
  const effectiveMaxWidth = fullWidth ? '100%' : maxWidth;
  const effectivePadding = fullWidth ? '0' : padding;
  const hospitalName = localStorage.getItem('hospitalName') || '';
  const userEmail = localStorage.getItem('userEmail') || '';
  const userName = localStorage.getItem('userName') || '';

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div style={{ ...logoContainerStyle, maxWidth: effectiveMaxWidth }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <img src="/tanuh.png" alt="TANUH Logo" style={{ height: 50, objectFit: 'contain' }} />
            <img src="/MoE_Logo.svg" alt="MoE Logo" style={{ height: 42, objectFit: 'contain' }} />
            <img src="/IISc_logo.png" alt="IISc Logo" style={{ height: 55, objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <h1 style={titleStyle}>AI enabled Breast Cancer Risk Prediction Tool</h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button onClick={handleLogout} style={logoutButtonStyle}>
              <LogOut size={14} />
              Logout
            </button>
            {hospitalName && <span style={hospitalBadgeStyle}>{hospitalName} — {userRole}</span>}
            {userName && <span style={userEmailStyle}>{userName}</span>}
            {userEmail && <span style={userEmailStyle}>{userEmail}</span>}
          </div>
        </div>
      </header>

      <main style={{ ...mainStyle, maxWidth: effectiveMaxWidth, padding: effectivePadding }}>
        {children}
      </main>
    </div>
  );
};

const containerStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: 'transparent',
  fontFamily: '"Inter", sans-serif'
};

const headerStyle = {
  padding: '14px 20px',
  backgroundColor: '#DAF3F4',
  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};

const logoContainerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  maxWidth: '1200px',
  margin: '0 auto',
  width: '100%',
  gap: '20px',
  flexWrap: 'wrap',
};

const titleStyle = {
  fontSize: '18px',
  fontWeight: '700',
  color: '#14868C',
  margin: 0,
  fontFamily: "'Poppins', sans-serif",
};

const hospitalBadgeStyle = {
  fontSize: '12px',
  color: '#555',
  fontWeight: '500',
};

const logoutButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 12px',
  backgroundColor: '#fff',
  color: '#dc3545',
  border: '1px solid #dc3545',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: '500',
  fontSize: '12px',
  fontFamily: 'inherit',
};

const userEmailStyle = {
  fontSize: '11px',
  color: '#777',
  fontWeight: '400',
};

const mainStyle = {
  flex: 1,
  padding: '20px',
  maxWidth: '1200px',
  margin: '0 auto',
  width: '100%'
};

export default Layout;
