import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DoctorAssessmentForm from '../components/DoctorAssessmentForm';
import BreastCaseReviewPanel from '../components/BreastCaseReviewPanel';

const STATUS_COLORS = { Accepted: 'green', Rejected: '#dc3545', Pending: '#b0691c' };

const CASE_VIEW_STORAGE_KEY = 'qc_mammotech_case_view_state';

const MammoTechPage = () => {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [isCaseViewOpen, setIsCaseViewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const role = (localStorage.getItem('role') || '').toLowerCase();
    if (!token || role !== 'mammotech') {
      navigate('/');
      return;
    }
    fetchCases();

    const saved = sessionStorage.getItem(CASE_VIEW_STORAGE_KEY);
    if (saved) {
      try {
        const { sessionId, caseItem } = JSON.parse(saved);
        if (sessionId && caseItem) fetchSessionDetail(sessionId, caseItem);
      } catch {
        sessionStorage.removeItem(CASE_VIEW_STORAGE_KEY);
      }
    }
  }, [navigate]);

  useEffect(() => {
    if (!isCaseViewOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !confirmOpen) closeCaseView();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCaseViewOpen, confirmOpen]);

  const fetchCases = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Authentication token missing. Please log in again.');
        setLoading(false);
        return;
      }
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/mammotech/cases`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCases(data.cases || []);
      } else {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
          const errorData = await response.json();
          setError(errorData.detail || 'Failed to fetch assigned cases');
        } else {
          setError(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      setError('An error occurred while fetching assigned cases');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetail = async (sessionId, caseItem) => {
    try {
      setSelectedCase(caseItem);
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Authentication token missing. Please log in again.');
        return;
      }
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/doctor/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSelectedSession(data);
        setIsCaseViewOpen(true);
        sessionStorage.setItem(CASE_VIEW_STORAGE_KEY, JSON.stringify({ sessionId, caseItem }));
      } else {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
          const errorData = await response.json();
          alert(`Failed to fetch case details: ${errorData.detail || 'Unknown error'}`);
        } else {
          alert(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while fetching case details');
    }
  };

  const closeCaseView = () => {
    setIsCaseViewOpen(false);
    setSelectedSession(null);
    sessionStorage.removeItem(CASE_VIEW_STORAGE_KEY);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setReviewError(null);
  };

  const submitQualityReview = async (qualityAccepted) => {
    try {
      setReviewSubmitting(true);
      setReviewError(null);
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/mammotech/cases/${selectedCase.case_id}/review`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quality_accepted: qualityAccepted }),
      });
      if (response.ok) {
        closeConfirm();
        closeCaseView();
        fetchCases();
      } else {
        const contentType = response.headers.get('content-type');
        const errorData = contentType && contentType.indexOf('application/json') !== -1 ? await response.json() : null;
        setReviewError((errorData && errorData.detail) || `Failed to submit (${response.status})`);
      }
    } catch (err) {
      console.error(err);
      setReviewError('An error occurred while submitting.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('hospitalName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('isSuperViewer');
    navigate('/');
  };

  const filtered = cases.filter(c => {
    if (!searchTerm) return true;
    return (c.qc_subject_id || '').toLowerCase().includes(searchTerm.toLowerCase());
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > pages) setCurrentPage(pages);
  }, [filtered.length, currentPage]);

  const showCount = !loading && !error && filtered.length > 0;

  return (
    <Layout userRole="mammotech" handleLogout={handleLogout} fullWidth={true}>
      <div style={contentStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h2 style={{ color: '#333', margin: 0 }}>Assigned Cases</h2>
            {showCount && (
              <div style={{ fontSize: 13, color: '#888' }}>
                Showing {paginated.length} of {filtered.length} assigned cases {searchTerm && `(filtered from ${cases.length})`}
              </div>
            )}
          </div>
          <input
            type="text"
            placeholder="Search by QC ID..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            style={{ width: 260, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #c8e0e2', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}

        {!loading && !error && cases.length === 0 && (
          <p style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No cases assigned yet.</p>
        )}

        {!loading && !error && cases.length > 0 && filtered.length === 0 && (
          <p style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No cases match "{searchTerm}".</p>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div style={tableContainerStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={headerRowStyle}>
                    <th style={thStyle}>QC ID</th>
                    <th style={thStyle}>Hospital</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => (
                    <tr key={c.case_id} style={rowStyle}>
                      <td style={tdStyle}>{c.qc_subject_id}</td>
                      <td style={tdStyle}>{c.hospital || '-'}</td>
                      <td style={statusCellStyle(c.status)}>{c.status}</td>
                      <td style={tdStyle}>
                        <button onClick={() => fetchSessionDetail(c.session_id, c)} style={linkButtonStyle}>
                          View Case
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 16 }}>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ ...paginationBtnStyle, opacity: currentPage === 1 ? 0.4 : 1 }}
                >Prev</button>
                <span style={{ fontSize: 13, color: '#666' }}>Page {currentPage} of {totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ ...paginationBtnStyle, opacity: currentPage === totalPages ? 0.4 : 1 }}
                >Next</button>
              </div>
            )}
          </>
        )}

        {isCaseViewOpen && selectedSession && (
          <div style={caseViewStyle}>
            <div style={caseViewHeaderStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                <button style={backButtonStyle} onClick={closeCaseView}>&#8592; Back to cases</button>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 17, color: '#233' }}>QC ID: {selectedCase?.qc_subject_id}</h3>
                  {selectedCase?.hospital && (
                    <div style={{ fontSize: 12.5, color: '#7c8a8d', marginTop: 2 }}>{selectedCase.hospital}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {selectedCase?.status === 'Accepted' || selectedCase?.status === 'Rejected' ? (
                  <span style={statusBadgeStyle(selectedCase.status)}>{selectedCase.status}</span>
                ) : (
                  <button style={reviewButtonStyle} onClick={() => setConfirmOpen(true)}>
                    Review
                  </button>
                )}
              </div>
            </div>
            <div style={caseViewBodyStyle}>
              <div style={caseViewInnerStyle}>
                <BreastCaseReviewPanel
                  sessionId={selectedSession.qc_id}
                  initialData={selectedSession.assessment}
                />
                <DoctorAssessmentForm
                  sessionId={selectedSession.qc_id}
                  initialData={selectedSession.assessment}
                  onSaveSuccess={() => {
                    fetchCases();
                    setTimeout(closeCaseView, 2000);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {confirmOpen && (
          <div style={modalOverlayStyle} onClick={closeConfirm}>
            <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Quality of Images Acceptable?</h3>
              <p style={{ color: '#495057' }}>QC ID: {selectedCase?.qc_subject_id}</p>
              {reviewError && <p style={{ color: 'red', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{reviewError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button style={dangerDialogBtnStyle} disabled={reviewSubmitting} onClick={() => submitQualityReview(false)}>
                  No
                </button>
                <button style={primaryDialogBtnStyle} disabled={reviewSubmitting} onClick={() => submitQualityReview(true)}>
                  {reviewSubmitting ? 'Saving...' : 'Yes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

const contentStyle = {
  backgroundColor: '#fff',
  padding: '20px',
  minHeight: '400px',
};

const tableContainerStyle = { overflowX: 'auto' };

const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: '10px' };

const headerRowStyle = { backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' };

const thStyle = { padding: '12px', textAlign: 'center', color: '#495057', fontWeight: '600' };

const rowStyle = { borderBottom: '1px solid #dee2e6' };

const tdStyle = { padding: '12px', verticalAlign: 'middle', textAlign: 'center' };

const statusCellStyle = (status) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: STATUS_COLORS[status] || '#b0691c',
  fontWeight: 'bold',
});

const statusBadgeStyle = (status) => ({
  padding: '4px 12px',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 600,
  backgroundColor: status === 'Accepted' ? '#e3f5e9' : '#fdeaea',
  color: status === 'Accepted' ? '#1e7e4b' : '#c0392b',
});

const caseViewStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: '#fff', zIndex: 2000, display: 'flex', flexDirection: 'column',
};

const caseViewHeaderStyle = {
  flexShrink: 0,
  padding: '12px clamp(16px, 3vw, 32px)',
  borderBottom: '1px solid #e3ecec',
  background: '#fff',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
};

const caseViewBodyStyle = { flex: 1, overflowY: 'auto', background: '#f7fafa' };

const caseViewInnerStyle = { width: '100%', padding: 'clamp(16px, 3vw, 32px)', boxSizing: 'border-box' };

const backButtonStyle = {
  padding: '8px 16px', borderRadius: 8, border: '1.5px solid #c8e0e2', background: '#fff',
  color: '#14868C', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  whiteSpace: 'nowrap', flexShrink: 0,
};

const reviewButtonStyle = {
  padding: '8px 18px', borderRadius: 8, border: 'none', background: '#14868C',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};

const confirmDialogStyle = {
  backgroundColor: '#fff', width: '90%', maxWidth: 440, borderRadius: 10, padding: 24,
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
};

const primaryDialogBtnStyle = {
  padding: '9px 18px', borderRadius: 8, border: 'none', background: '#14868C',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};

const dangerDialogBtnStyle = {
  padding: '9px 18px', borderRadius: 8, border: 'none', background: '#dc3545',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};

const linkButtonStyle = {
  background: 'none', border: 'none', color: '#14868C', textDecoration: 'underline',
  cursor: 'pointer', padding: '0', fontSize: '14px',
};

const paginationBtnStyle = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid #c8e0e2', background: '#fff',
  color: '#14868C', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};

const modalOverlayStyle = {
  position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2100,
};

export default MammoTechPage;
