import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Layout from '../Layout';

const RISK_COLORS = {
  'Baseline Risk': '#6ee7b7',
  'Evident Risk': '#fde047',
  'Significant Risk': '#fb923c',
  'High Risk': '#fb7185'
};

const tabContainerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
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
  borderBottom: '3px solid #14868C',
  color: '#14868C',
  fontWeight: 'bold'
};

const contentStyle = { backgroundColor: '#fff', padding: '20px', minHeight: '400px' };
const tableContainerStyle = { overflowX: 'auto' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: '10px' };
const headerRowStyle = { backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' };
const thCenterStyle = { padding: '12px', textAlign: 'center', color: '#495057', fontWeight: '600' };
const rowStyle = { borderBottom: '1px solid #dee2e6' };
const tdStyle = { padding: '12px', verticalAlign: 'middle', textAlign: 'center' };

const statusCellStyle = (isTrue) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: isTrue ? 'green' : 'red',
  fontWeight: 'bold',
});

const linkButtonStyle = {
  background: 'none',
  border: 'none',
  color: '#14868C',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: '0',
  fontSize: '14px'
};

const modalOverlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
};

const modalContentStyle = {
  backgroundColor: '#fff',
  width: '80%',
  maxWidth: '90vw',
  maxHeight: '80vh',
  borderRadius: '8px',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)'
};

const modalHeaderStyle = {
  padding: '15px 20px',
  borderBottom: '1px solid #dee2e6',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const modalBodyStyle = { padding: '20px', overflowY: 'auto' };
const closeButtonStyle = { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666' };
const qaTableStyle = { width: '100%', borderCollapse: 'collapse' };
const qaThStyle = { textAlign: 'left', padding: '10px', borderBottom: '2px solid #dee2e6', backgroundColor: '#f8f9fa' };
const qaTdStyle = { padding: '10px', borderBottom: '1px solid #eee' };

const QcRadiologistSubjects = () => {
  const navigate = useNavigate();

  const [qcRole, setQcRole] = useState('');
  const [qcUserName, setQcUserName] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedSubject, setSelectedSubject] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('qcRole');
    const token = localStorage.getItem('qcToken');
    const userId = localStorage.getItem('qcUserId');
    const userName = localStorage.getItem('qcUserName');

    if (!token || !role || !userId) {
      navigate('/qc-bcd-login');
      return;
    }

    setQcRole(role);
    setQcUserName(userName || '');
    setAuthChecked(true);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('qcToken');
    localStorage.removeItem('qcRole');
    localStorage.removeItem('qcUserEmail');
    localStorage.removeItem('qcUserName');
    localStorage.removeItem('qcUserId');
    navigate('/qc-bcd-login');
  };

  const apiBase = process.env.REACT_APP_API_URL || '';
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('qcToken')}`
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchSubjects();
    // eslint-disable-next-line
  }, [authChecked]);

  const fetchSubjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = localStorage.getItem('qcUserId');
      const response = await fetch(`${apiBase}/api/v1/qc/radiologist/${userId}/subjects`, {
        headers: authHeaders
      });
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch assigned subjects');
      const data = await response.json();
      setSubjects(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch assigned subjects', err);
      setError('Failed to load assigned subjects');
      toast.error('Failed to load assigned subjects');
    } finally {
      setLoading(false);
    }
  };

  const fetchSubjectDetail = async (sessionId) => {
    setDetailLoading(true);
    try {
      const userId = localStorage.getItem('qcUserId');
      const response = await fetch(
        `${apiBase}/api/v1/qc/radiologist/${userId}/subjects/${sessionId}`,
        { headers: authHeaders }
      );
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (response.status === 403) {
        toast.error('This subject is not assigned to you');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch subject details');
      const data = await response.json();
      setSelectedSubject(data);
      setIsModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch subject details', err);
      toast.error('An error occurred while loading subject details');
    } finally {
      setDetailLoading(false);
    }
  };

  if (!authChecked) {
    return null;
  }

  return (
    <Layout userRole={qcRole} handleLogout={handleLogout} fullWidth={true}>
      <div style={tabContainerStyle}>
        <button style={tabButtonStyle}>My Assigned Subjects</button>
        <span style={{ fontSize: '14px', color: '#666' }}>
          {qcUserName ? `Logged in as ${qcUserName}` : ''}
        </span>
      </div>

      <div style={contentStyle}>
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}

        {!loading && !error && subjects.length === 0 && (
          <p>No subjects assigned to you yet.</p>
        )}

        {!loading && !error && subjects.length > 0 && (
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={thCenterStyle}>Subject ID</th>
                  <th style={thCenterStyle}>Hospital</th>
                  <th style={thCenterStyle}>Date</th>
                  <th style={thCenterStyle}>Risk</th>
                  <th style={thCenterStyle}>Assessment</th>
                  <th style={thCenterStyle}>Mammography + Report</th>
                  <th style={thCenterStyle}>Breast Ultrasound + Report</th>
                  <th style={thCenterStyle}>Biopsy</th>
                  <th style={thCenterStyle}>Annotations</th>
                  <th style={thCenterStyle}>Additional Docs</th>
                  <th style={thCenterStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((session) => (
                  <tr key={session.id} style={rowStyle}>
                    <td style={tdStyle}>{session.patient_id || session.id?.substring(0, 8)}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>{session.hospital_name || '-'}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      {session.consent_timestamp
                        ? new Date(session.consent_timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '-'}
                    </td>
                    <td style={tdStyle}>
                      {session.risk_category ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 600,
                          backgroundColor: RISK_COLORS[session.risk_category] || '#eee',
                          color: '#111',
                        }}>
                          {session.risk_category.replace(' Risk', '')}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={statusCellStyle(session.has_assessment)}>
                      {session.has_assessment ? 'Yes' : 'No'}
                    </td>
                    <td style={tdStyle}>
                      {(() => {
                        const isSMR = session.has_mammo_reading === 'SMR';
                        const isYes = session.has_mammo_dicom && (session.has_mammo_reading === 'Yes' || isSMR);
                        return (
                          <span style={{ color: isSMR ? '#0d6efd' : isYes ? 'green' : 'red', fontWeight: 'bold', fontSize: isSMR ? 12 : 'inherit' }}>
                            {isSMR ? 'Yes (SMR)' : isYes ? 'Yes' : 'No'}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={tdStyle}>
                      {(() => {
                        const isSMR = session.has_us_reading === 'SMR';
                        const isYes = (session.has_us_video === 'Yes' || session.has_us_video === 'SMR') && (session.has_us_reading === 'Yes' || isSMR);
                        return (
                          <span style={{ color: isSMR ? '#0d6efd' : isYes ? 'green' : 'red', fontWeight: 'bold', fontSize: isSMR ? 12 : 'inherit' }}>
                            {isSMR ? 'Yes (SMR)' : isYes ? 'Yes' : 'No'}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={statusCellStyle(session.has_biopsy)}>{session.has_biopsy ? 'Yes' : 'No'}</td>
                    <td style={statusCellStyle(session.has_annotations)}>{session.has_annotations ? 'Yes' : 'No'}</td>
                    <td style={statusCellStyle(session.has_additional_docs)}>{session.has_additional_docs ? 'Yes' : 'No'}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => fetchSubjectDetail(session.id)}
                        style={linkButtonStyle}
                        disabled={detailLoading}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && selectedSubject && (
        <div style={modalOverlayStyle} onClick={() => setIsModalOpen(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3>Responses for Subject ID: {selectedSubject.patient_id || selectedSubject.id}</h3>
              <button style={closeButtonStyle} onClick={() => setIsModalOpen(false)}>&times;</button>
            </div>
            <div style={modalBodyStyle}>
              <table style={qaTableStyle}>
                <thead>
                  <tr>
                    <th style={qaThStyle}>Question</th>
                    <th style={qaThStyle}>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSubject.responses && selectedSubject.responses.length > 0 ? (
                    selectedSubject.responses.map((resp) => (
                      <tr key={resp.id}>
                        <td style={qaTdStyle}>{resp.question}</td>
                        <td style={qaTdStyle}>{resp.answer}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="2" style={qaTdStyle}>No responses found for this session.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {!selectedSubject.assessment && (
                <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 6, backgroundColor: '#f0f4ff', border: '1px solid #c8d8f8', color: '#3a5a9e', fontSize: 13 }}>
                  No assessment has been submitted for this subject yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default QcRadiologistSubjects;