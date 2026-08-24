import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RadiologistPage from './RadiologistPage';
import QCAdminDashboard from '../components/QCAdminDashboard';
import AssignRadiologistHistory from '../components/AssignRadiologistHistory';

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState('qc-admin');
  const navigate = useNavigate();

  const [userRole, setUserRole] = useState('');
  const [hospitalName, setHospitalName] = useState('');

  useEffect(() => {
    const role = localStorage.getItem('role')?.toLowerCase();
    const token = localStorage.getItem('token');
    const hospital = localStorage.getItem('hospitalName');

    if (!token || !['admin', 'radiologist'].includes(role)) {
      navigate('/qc/login');
    } else {
      setUserRole(role);
      setHospitalName(hospital || '');

      if (role === 'radiologist') {
        navigate('/qc/radiologist');
      }
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('hospitalName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    navigate('/qc/login');
  };

  const tabs = [
    { id: 'qc-admin', label: 'QC Admin' },
    { id: 'assign-history', label: 'Radiologist History' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'qc-admin':
        return <div style={contentStyle}><QCAdminDashboard /></div>;
      case 'radiologist':
        return <RadiologistPageContent />;
      case 'assign-history':
        return <div style={contentStyle}><AssignRadiologistHistory /></div>;
      default:
        return null;
    }
  };

  if (userRole !== 'admin') {
    return null; // or a loading spinner while redirecting
  }

  return (
    <Layout userRole="admin" handleLogout={handleLogout} fullWidth={true}>
      <div style={tabContainerStyle}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...tabButtonStyle,
              borderBottom: activeTab === tab.id ? '3px solid #14868C' : 'none',
              color: activeTab === tab.id ? '#14868C' : '#666',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '20px' }}>
        {renderContent()}
      </div>
    </Layout>
  );
};

const RadiologistPageContent = () => {
  return <RadiologistPage isEmbedded={true} />;
};

const tabContainerStyle = {
  display: 'flex',
  justifyContent: 'center',
  backgroundColor: 'white',
  borderBottom: '1px solid #ddd',
  padding: '0 20px',
  borderRadius: '8px 8px 0 0'
};

const tabButtonStyle = {
  padding: '15px 30px',
  fontSize: '16px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.3s ease'
};

const contentStyle = {
  backgroundColor: 'white',
  padding: '40px',
  minHeight: '400px',
  color: '#666'
};

const ManageInstitutionsContent = ({ hospitalName }) => {
  const [expandedSection, setExpandedSection] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(false);

  // Forms states
  const [hospitalForm, setHospitalForm] = useState({ name: '', shortName: '', contactPerson: '', email: '', address: '', pincode: '', state: '', modalityType: '' });
  const [adminForm, setAdminForm] = useState({ fullName: '', email: '', password: '', hospitalId: '' });
  const [machineForm, setMachineForm] = useState({
    hospitalId: '',
    hospitalShortName: '',
    machineName: '',
    machineMake: '',
    machineTechnology: '',
    noOfMachines: ''
  });

  useEffect(() => {
    fetchHospitals();
  }, []);

  const fetchHospitals = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/qc/auth/hospitals`);
      const contentType = response.headers.get("content-type");
      if (response.ok && contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setHospitals(data);
        } else {
          console.error("Hospitals data is not an array:", data);
          alert("Error: Received invalid data format for hospitals.");
        }
      } else {
        const text = await response.text();
        console.error("Failed to fetch hospitals, response not ok or non-JSON:", text);
        alert(`Error: Failed to fetch hospitals list. Status: ${response.status}`);
      }
    } catch (err) {
      console.error("Failed to fetch hospitals", err);
      alert("Error: Network error while fetching hospitals.");
    }
  };

  const [showPasswords, setShowPasswords] = useState({});
  const togglePasswordVisibility = (key) => setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleCreateAdmin = async () => {
    if (!isValidEmail(adminForm.email)) {
      alert("Error: Please enter a valid email address.");
      return;
    }
    if (!adminForm.fullName || !adminForm.password || !adminForm.hospitalId) {
      alert("Error: Full Name, Password and Institution are required.");
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/qc/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          full_name: adminForm.fullName,
          email: adminForm.email,
          password: adminForm.password,
          role: 'Admin',
          hospital_id: adminForm.hospitalId,
        })
      });

      if (response.ok) {
        alert('Admin account created successfully!');
        setAdminForm({ fullName: '', email: '', password: '', hospitalId: '' });
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const error = await response.json();
          const detail = error.detail;
          const message = Array.isArray(detail) ? detail.map(d => d.msg || JSON.stringify(d)).join('; ') : (detail || 'Failed to create account');
          alert(`Error: ${message}`);
        } else {
          const errorText = await response.text();
          console.error("Non-JSON error response:", errorText);
          alert(`Error: Received non-JSON response from server. Status: ${response.status}`);
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateHospital = async () => {
    if (!hospitalForm.name || !hospitalForm.contactPerson || !hospitalForm.email || !hospitalForm.state || !hospitalForm.modalityType || !hospitalForm.shortName) {
      alert('Error: Institution Name, Contact Person, Email, State and Modality Type are required.');
      return;
    }
    if (!isValidEmail(hospitalForm.email)) {
      alert('Error: Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/qc/admin/hospitals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          qc_name: hospitalForm.name,
          qc_short_name: hospitalForm.shortName,
          qc_contact_person: hospitalForm.contactPerson,
          qc_email: hospitalForm.email,
          qc_address: hospitalForm.address,
          qc_pincode: hospitalForm.pincode,
          qc_state: hospitalForm.state,
          qc_type: hospitalForm.modalityType
        })
      });

      if (response.ok) {
        alert('Institution account created successfully!');
        setHospitalForm({ name: '', shortName: '', contactPerson: '', email: '', address: '', pincode: '', state: '', modalityType: '' });
        fetchHospitals(); // Refresh hospital list
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const error = await response.json();
          const detail = error.detail;
          const message = Array.isArray(detail) ? detail.map(d => d.msg || JSON.stringify(d)).join('; ') : (detail || 'Failed to create institution');
          alert(`Error: ${message}`);
        } else {
          const errorText = await response.text();
          console.error("Non-JSON error response:", errorText);
          alert(`Error: Received non-JSON response from server. Status: ${response.status}`);
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMachine = async () => {
    if (!machineForm.hospitalId || !machineForm.machineName || !machineForm.machineMake || !machineForm.machineTechnology || !machineForm.noOfMachines) {
      alert('Error: Institute, Machine Name, Machine Make, Machine Technology and No. of Machines are required.');
      return;
    }
    if (!/^[0-9]+$/.test(machineForm.noOfMachines) || Number(machineForm.noOfMachines) <= 0) {
      alert('Error: No. of Machines must be a positive whole number.');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/qc/admin/machines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          qc_hospital_id: machineForm.hospitalId,
          qc_hospital_short_name: machineForm.hospitalShortName,
          qc_machine: machineForm.machineName,
          qc_make: machineForm.machineMake,
          qc_technology: machineForm.machineTechnology,
          qc_no_of_machines: Number(machineForm.noOfMachines)
        })
      });

      if (response.ok) {
        alert('Machine details created successfully!');
        setMachineForm({ hospitalId: '', hospitalShortName: '', machineName: '', machineMake: '', machineTechnology: '', noOfMachines: '' });
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const error = await response.json();
          const detail = error.detail;
          const message = Array.isArray(detail) ? detail.map(d => d.msg || JSON.stringify(d)).join('; ') : (detail || 'Failed to create machine details');
          alert(`Error: ${message}`);
        } else {
          const errorText = await response.text();
          console.error("Non-JSON error response:", errorText);
          alert(`Error: Received non-JSON response from server. Status: ${response.status}`);
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div style={{ color: '#333' }}>
      <h2 style={{ marginBottom: '20px', color: '#14868C' }}>Manage Institutions</h2>

      {/* 1. Create another institution account */}
      {hospitalName === 'Test' && (
        <div style={accordionStyle}>
          <div style={accordionHeaderStyle} onClick={() => toggleSection('hospital')}>
            1. Create another institution account
            <span>{expandedSection === 'hospital' ? '−' : '+'}</span>
          </div>
          {expandedSection === 'hospital' && (
            <div style={accordionContentStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Institution Name</label>
                <input
                  style={inputStyle}
                  value={hospitalForm.name}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, name: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ ...formGroupStyle, flex: 1 }}>
                  <label style={labelStyle}>Short Name</label>
                  <input
                    style={inputStyle}
                    value={hospitalForm.shortName}
                    maxLength={20}
                    onChange={(e) => setHospitalForm({ ...hospitalForm, shortName: e.target.value })}
                  />
                </div>
                <div style={{ ...formGroupStyle, flex: 1 }}>
                  <label style={labelStyle}>Modality Type</label>
                  <select
                    style={inputStyle}
                    value={hospitalForm.modalityType}
                    onChange={(e) => setHospitalForm({ ...hospitalForm, modalityType: e.target.value })}
                  >
                    <option value="">Select Modality Type</option>
                    <option value="CR">CR</option>
                    <option value="DR">DR</option>
                  </select>
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Contact Person</label>
                <input
                  style={inputStyle}
                  value={hospitalForm.contactPerson}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, contactPerson: e.target.value })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Email</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={hospitalForm.email}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, email: e.target.value })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Address</label>
                <textarea
                  style={{ ...inputStyle, height: '80px' }}
                  value={hospitalForm.address}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, address: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ ...formGroupStyle, flex: 1 }}>
                  <label style={labelStyle}>Pincode</label>
                  <input
                    style={inputStyle}
                    value={hospitalForm.pincode}
                    placeholder="e.g. 560012"
                    maxLength={10}
                    onChange={(e) => setHospitalForm({ ...hospitalForm, pincode: e.target.value })}
                  />
                </div>
                <div style={{ ...formGroupStyle, flex: 2 }}>
                  <label style={labelStyle}>State</label>
                  <select
                    style={inputStyle}
                    value={hospitalForm.state}
                    onChange={(e) => setHospitalForm({ ...hospitalForm, state: e.target.value })}
                  >
                    <option value="">Select State</option>
                    {["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                style={{ ...buttonStyle, opacity: loading ? 0.7 : 1 }}
                disabled={loading}
                onClick={handleCreateHospital}
              >
                {loading ? 'Creating...' : 'Create Institution Account'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 2. Create admin account for another hospital */}
      {hospitalName === 'Test' && (
        <div style={accordionStyle}>
          <div style={accordionHeaderStyle} onClick={() => toggleSection('admin-user')}>
            2. Create admin account for another institution
            <span>{expandedSection === 'admin-user' ? '−' : '+'}</span>
          </div>
          {expandedSection === 'admin-user' && (
            <div style={accordionContentStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Full Name</label>
                <input
                  style={inputStyle}
                  value={adminForm.fullName}
                  onChange={(e) => setAdminForm({ ...adminForm, fullName: e.target.value })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Email</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    style={inputStyle}
                    type={showPasswords.admin ? 'text' : 'password'}
                    value={adminForm.password}
                    onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  />
                  <span onClick={() => togglePasswordVisibility('admin')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '18px', userSelect: 'none' }}>{showPasswords.admin ? '🙈' : '👁️'}</span>
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Institution</label>
                <select
                  style={inputStyle}
                  value={adminForm.hospitalId}
                  onChange={(e) => setAdminForm({ ...adminForm, hospitalId: e.target.value })}
                >
                  <option value="">Select Institution</option>
                  {hospitals.map(h => <option key={h.qc_id} value={h.qc_id}>{h.qc_name}</option>)}
                </select>
              </div>
              <button
                style={{ ...buttonStyle, opacity: loading ? 0.7 : 1 }}
                disabled={loading}
                onClick={handleCreateAdmin}
              >
                {loading ? 'Creating...' : 'Create Admin Account'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Create Machine Details for Institution */}
      <div style={accordionStyle}>
        <div style={accordionHeaderStyle} onClick={() => toggleSection('machine')}>
          3. Create Machine Details for Institution
          <span>{expandedSection === 'machine' ? '−' : '+'}</span>
        </div>
        {expandedSection === 'machine' && (
          <div style={accordionContentStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Select Institute</label>
              <select
                style={inputStyle}
                value={machineForm.hospitalId}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const selectedHospital = hospitals.find(h => h.qc_id === selectedId);
                  setMachineForm({
                    ...machineForm,
                    hospitalId: selectedId,
                    hospitalShortName: selectedHospital ? selectedHospital.qc_short_name : ''
                  });
                }}
              >
                <option value="">Select Institute</option>
                {hospitals.map(h => <option key={h.qc_id} value={h.qc_id}>{h.qc_name}</option>)}
              </select>
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Machine Name</label>
              <input
                style={inputStyle}
                value={machineForm.machineName}
                onChange={(e) => setMachineForm({ ...machineForm, machineName: e.target.value })}
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Machine Make</label>
              <input
                style={inputStyle}
                value={machineForm.machineMake}
                onChange={(e) => setMachineForm({ ...machineForm, machineMake: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ ...formGroupStyle, flex: 1 }}>
                <label style={labelStyle}>Machine Technology</label>
                <input
                  style={inputStyle}
                  value={machineForm.machineTechnology}
                  onChange={(e) => setMachineForm({ ...machineForm, machineTechnology: e.target.value })}
                />
              </div>
              <div style={{ ...formGroupStyle, flex: 1 }}>
                <label style={labelStyle}>No. of Machine</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={machineForm.noOfMachines}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^[0-9]+$/.test(val)) {
                      setMachineForm({ ...machineForm, noOfMachines: val });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                />
              </div>
            </div>
            <button
              style={{ ...buttonStyle, opacity: loading ? 0.7 : 1 }}
              disabled={loading}
              onClick={handleCreateMachine}
            >
              {loading ? 'Creating...' : 'Create Machine Detail'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const accordionStyle = {
  marginBottom: '10px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  overflow: 'hidden'
};

const accordionHeaderStyle = {
  padding: '15px',
  backgroundColor: '#f8f9fa',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 'bold',
  color: '#333'
};

const accordionContentStyle = {
  padding: '20px',
  borderTop: '1px solid #ddd',
  backgroundColor: 'white'
};

const formGroupStyle = {
  marginBottom: '15px'
};

const labelStyle = {
  display: 'block',
  marginBottom: '5px',
  fontWeight: '500'
};

const inputStyle = {
  width: '100%',
  padding: '8px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  boxSizing: 'border-box'
};

const buttonStyle = {
  padding: '10px 20px',
  backgroundColor: '#14868C',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold',
  marginTop: '10px'
};

export default AdminPage;
