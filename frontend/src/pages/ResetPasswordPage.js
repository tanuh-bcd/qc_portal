import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    hospitalName: '',
    role: '',
    email: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.hospitalName || !formData.role || !formData.email || !formData.newPassword || !formData.confirmPassword) {
      toast.error('Please fill in all fields');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (formData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospital_name: formData.hospitalName,
          role: formData.role.charAt(0).toUpperCase() + formData.role.slice(1),
          email: formData.email,
          new_password: formData.newPassword
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Password reset successfully! Please login with your new password.');
        navigate('/login');
      } else {
        toast.error(data.detail || 'Failed to reset password');
      }
    } catch (err) {
      toast.error('Could not connect to the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchHospitals = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/auth/hospitals`);
        if (!response.ok) throw new Error('Failed to fetch hospitals');
        const data = await response.json();
        setHospitals(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchHospitals();
  }, []);

  const inputStyle = { padding: '8px', borderRadius: '4px', border: '1px solid #ccc' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: '20px', backgroundColor: 'transparent', fontFamily: '"Inter", sans-serif' }}>
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '30px', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2.5rem', flexWrap: 'wrap' }}>
          <a href={process.env.REACT_APP_WEBSITE_URL} target="_blank" rel="noopener noreferrer">
            <img src="/tanuh.png" alt="TANUH Logo" style={{ height: '65px', objectFit: 'contain' }} />
          </a>
          <img src="/MoE_Logo.svg" alt="Ministry of Education Logo" style={{ height: '55px', objectFit: 'contain' }} />
          <img src="/IISc_logo.png" alt="IISc Logo" style={{ height: '75px', objectFit: 'contain' }} />
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#14868C', textAlign: 'center', margin: 0, fontFamily: "'Poppins', sans-serif" }}>
          AI enabled Breast Cancer Risk Prediction Tool
        </h1>
        <p style={{ color: '#e91e8c', fontWeight: 800, fontSize: '1.5rem', fontFamily: "'Poppins', sans-serif", letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>
          PinkShieldAI
        </p>
      </header>

      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '0 16px' }}>
        <div style={{ width: '100%', maxWidth: '420px', border: '1px solid rgba(0,0,0,0.05)', padding: '30px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(20,134,140,0.1)', backgroundColor: 'white', borderTop: '5px solid #14868C' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>Reset Password</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="hospitalName">Institution Name</label>
              <select id="hospitalName" name="hospitalName" value={formData.hospitalName} onChange={handleChange} style={inputStyle} disabled={loading}>
                <option value="">{loading ? 'Loading institutions...' : 'Select Institution'}</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.id} value={hospital.name}>{hospital.name}</option>
                ))}
              </select>
              {error && <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="role">Role</label>
              <select id="role" name="role" value={formData.role} onChange={handleChange} style={inputStyle}>
                <option value="">Select Role</option>
                <option value="clinician">Clinician</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="email">Email address</label>
              <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="newPassword">New Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showNewPassword ? 'text' : 'password'} id="newPassword" name="newPassword" value={formData.newPassword} onChange={handleChange} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                <span onClick={() => setShowNewPassword(!showNewPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '18px', userSelect: 'none' }}>{showNewPassword ? '🙈' : '👁️'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirmPassword ? 'text' : 'password'} id="confirmPassword" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                <span onClick={() => setShowConfirmPassword(!showConfirmPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '18px', userSelect: 'none' }}>{showConfirmPassword ? '🙈' : '👁️'}</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{ padding: '10px', backgroundColor: submitting ? '#ccc' : '#14868C', color: 'white', border: 'none', borderRadius: '4px', cursor: submitting ? 'not-allowed' : 'pointer', marginTop: '10px' }}
            >
              {submitting ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button onClick={() => navigate('/login')} style={{ background: 'none', border: 'none', color: '#14868C', cursor: 'pointer', textDecoration: 'underline' }}>
              Back to Login
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ResetPasswordPage;
