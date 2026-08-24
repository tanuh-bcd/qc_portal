import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import '../../pages/LoginPage.css';

const QcLogin = () => {
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
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

    if (!formData.role || !formData.email || !formData.password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoginLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/qc-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: formData.role,
          email: formData.email,
          password: formData.password
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const userName = data.full_name || formData.email;
        toast.success(`\u{1F44B} Welcome, ${userName}!`, { autoClose: 4000 });
        localStorage.setItem('qcToken', data.access_token);
        localStorage.setItem('qcRole', formData.role);
        localStorage.setItem('qcUserEmail', formData.email);
        localStorage.setItem('qcUserName', userName);
        localStorage.setItem('qcUserId', String(data.qc_id));

        if (formData.role === 'QC Radiologist') {
          navigate('/qc-radiologist/dashboard');
        } else {
          navigate('/quality-check/dashboard');
        }
      } else {
        const errorMsg = data.detail || 'Credentials wrong';
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error('QC login error:', err);
      toast.error('An error occurred during login. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/qc-roles`);
        if (!response.ok) {
          throw new Error('Failed to fetch roles');
        }
        const data = await response.json();
        setRoles(data);
      } catch (err) {
        console.error('Error fetching QC roles:', err);
        setError(err.message);
      } finally {
        setRolesLoading(false);
      }
    };

    fetchRoles();
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
          PinkShieldAI - Quality Check
        </p>
      </header>

      <main className="login-main">
        <div className="login-card">
          <h2>Enter credentials</h2>
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="role">Role</label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                disabled={rolesLoading}
              >
                <option value="">{rolesLoading ? 'Loading roles...' : 'Select Role'}</option>
                {roles.map((role) => (
                  <option key={role.qc_id} value={role.qc_name}>
                    {role.qc_name}
                  </option>
                ))}
              </select>
              {error && <span className="login-error">{error}</span>}
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
        </div>
      </main>
    </div>
  );
};

export default QcLogin;