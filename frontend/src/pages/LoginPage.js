import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import './LoginPage.css';

const LoginPage = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    hospitalName: '',
    role: '',
    email: '',
    password: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.hospitalName || !formData.role || !formData.email || !formData.password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoginLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hospital_name: formData.hospitalName,
          role: formData.role.charAt(0).toUpperCase() + formData.role.slice(1),
          email: formData.email,
          password: formData.password
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const userName = data.full_name || formData.email;
        toast.success(`\u{1F44B} Welcome, ${userName}!`, { autoClose: 4000 });
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('role', formData.role);
        localStorage.setItem('hospitalName', formData.hospitalName);
        localStorage.setItem('userEmail', formData.email);
        localStorage.setItem('userName', userName);
        localStorage.setItem('isSuperViewer', data.is_super_viewer ? 'true' : 'false');

        const roleLower = formData.role.toLowerCase();
        if (roleLower === 'admin') {
          navigate('/admin');
        } else if (roleLower === 'clinician') {
          navigate('/doctor');
        } else if (roleLower === 'staff') {
          navigate('/patient');
        }
      } else {
        const errorMsg = data.detail || 'Credentials wrong';
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error('Login error:', err);
      toast.error('An error occurred during login. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    const fetchHospitals = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/hospitals`);
        if (!response.ok) {
          throw new Error('Failed to fetch hospitals');
        }
        const data = await response.json();
        setHospitals(data);
      } catch (err) {
        console.error('Error fetching hospitals:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHospitals();
  }, []);

  return (
    <div className="login-page">
      <header className="login-header">
        <div className="logos-container">
          <a href={process.env.REACT_APP_WEBSITE_URL} target="_blank" rel="noopener noreferrer">
            <img src="/tanuh.png" alt="TANUH Logo" className="logo-tanuh" />
          </a>
          <img src="/MoE_Logo.svg" alt="Ministry of Education Logo" className="logo-moe" />
          <img src="/IISc_logo.png" alt="IISc Logo" className="logo-iisc" />
        </div>
        <h1 className="login-title">
          AI enabled Breast Cancer Risk Prediction Tool
        </h1>
        <p className="login-subtitle">
          PinkShieldAI
        </p>
      </header>

      <main className="login-main">
        <div className="login-card">
          <h2>Enter credentials</h2>
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="hospitalName">Institution Name</label>
              <select
                id="hospitalName"
                name="hospitalName"
                value={formData.hospitalName}
                onChange={handleChange}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading institutions...' : 'Select Institution'}</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.id} value={hospital.name}>
                    {hospital.name}
                  </option>
                ))}
              </select>
              {error && <span className="login-error">{error}</span>}
            </div>
            <div className="login-field">
              <label htmlFor="role">Role</label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
              >
                <option value="">Select Role</option>
                <option value="clinician">Clinician</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            <div className="login-field">
              <label htmlFor="email">Email address</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                />
                <span className="login-password-toggle" onClick={() => setShowPassword(!showPassword)}>{showPassword ? '\u{1F648}' : '\u{1F441}\u{FE0F}'}</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              className="login-submit"
            >
              {loginLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <div className="login-reset-link">
            <button onClick={() => navigate('/reset-password')}>
              Reset password
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
