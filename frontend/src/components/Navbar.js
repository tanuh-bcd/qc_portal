import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navbar.css';

const Navbar = () => {
  const location = useLocation();
  const [scrollY, setScrollY] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > scrollY && currentScrollY > 80) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      setScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [scrollY]);

  return (
    <nav className={`navbar-container ${hidden ? 'hidden' : ''}`}>
      <div className="navbar-content">
        <div className="navbar-logo">
          <Link to="/" className="logo-link">
            <img src="/tanuh.png" alt="Tanuh Logo" className="logo-img logo-tanuh" />
            <img src="/MoE_Logo.svg" alt="MOE Logo" className="logo-img logo-moe" />
            <img src="/IISc_logo.png" alt="IISc Logo" className="logo-img logo-iisc" />
          </Link>
        </div>
        <div className="navbar-tabs">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
            Questionnaire
          </Link>
          <Link to="/demo" className={`nav-link ${location.pathname === '/demo' ? 'active' : ''}`}>
            Demo
          </Link>
          <Link to="/stats" className={`nav-link ${location.pathname === '/stats' ? 'active' : ''}`}>
            Dashboard
          </Link>
          <Link to="/login" className={`nav-link ${location.pathname === '/login' ? 'active' : ''}`}>
            Login
          </Link>
          <Link to="/qc-bcd-login" className={`nav-link ${location.pathname === '/qc-login' ? 'active' : ''}`}>
            QC
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
