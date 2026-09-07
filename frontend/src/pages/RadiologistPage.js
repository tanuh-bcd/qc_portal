import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DoctorAssessmentForm from '../components/DoctorAssessmentForm';
import BreastCaseReviewPanel from '../components/BreastCaseReviewPanel';
import DicomCaseViewer from '../components/DicomCaseViewer';

const RISK_COLORS = { Baseline: '#6ee7b7', Evident: '#fde047', Significant: '#fb923c', High: '#fb7185' };
const riskLabel = (risk) => (risk ? risk.replace(' Risk', '') : null);

// Reasons are saved one per line. Older records were joined with '; ', so fall
// back to that separator only when there are no newlines — otherwise a semicolon
// typed inside an "Other" description would get split apart.
const splitReasons = (notes) => {
  const text = String(notes || '').trim();
  if (!text) return [];
  const parts = text.includes('\n') ? text.split(/\r?\n/) : text.split(/;\s*/);
  return parts.map(p => p.trim()).filter(Boolean);
};

const RiskBadge = ({ risk }) => {
  const label = riskLabel(risk);
  if (!label) return <span style={{ color: '#aaa' }}>-</span>;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
      backgroundColor: RISK_COLORS[label] || '#eee', color: '#111',
    }}>{label}</span>
  );
};

const RadiologistPage = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const role = (localStorage.getItem('role') || '').toLowerCase();
  // Admins (embedded in AdminPage, or viewing the standalone route directly) see the
  // full cross-hospital assignment history instead of a single radiologist's own cases.
  const isAdminView = isEmbedded || role === 'admin';
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [isCaseViewOpen, setIsCaseViewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reasonModal, setReasonModal] = useState(null);
  const PAGE_SIZE = 10;

  useEffect(() => {
    if (!isEmbedded) {
      const token = localStorage.getItem('token');
      if (!token || (role !== 'radiologist' && role !== 'admin')) {
        navigate('/');
        return;
      }
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
  }, [navigate, isEmbedded]);

  // Only the admin-embedded read-only case view needs this — the radiologist's
  // own view renders DicomCaseViewer instead, which manages Esc/body-overflow itself.
  useEffect(() => {
    if (!isCaseViewOpen || !isAdminView) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !reasonModal) closeCaseView();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCaseViewOpen, isAdminView, reasonModal]);

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
      const endpoint = isAdminView ? '/api/v1/qc/admin/assignments' : '/api/v1/qc/radiologist/cases';
      const response = await fetch(`${apiUrl}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCases(isAdminView ? (data || []) : (data.cases || []));
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

  const CASE_VIEW_STORAGE_KEY = 'qc_case_view_state';

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
    const term = searchTerm.toLowerCase();
    if (isAdminView) {
      return (c.qc_subject_id || '').toLowerCase().includes(term)
        || (c.hospital_name || '').toLowerCase().includes(term)
        || (c.radiologist_name || '').toLowerCase().includes(term)
        || (c.radiologist_email || '').toLowerCase().includes(term);
    }
    return (c.qc_subject_id || '').toLowerCase().includes(term);
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > pages) setCurrentPage(pages);
  }, [filtered.length, currentPage]);

  const showCount = !loading && !error && filtered.length > 0;

  const content = (
    <div style={{ ...contentStyle, ...(isEmbedded ? { paddingTop: 12 } : null) }}>
      {/* Embedded in AdminPage the tab strip already says "Radiologist History",
          and AdminPage supplies the app header — so no title here. The count sits
          on this row too, so it lines up with the search box. */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center', marginBottom: isEmbedded ? 8 : 14, flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {!isEmbedded && (
            <h2 style={{ color: '#333', margin: 0 }}>{isAdminView ? 'Radiologist History — Assigned Cases' : 'Assigned Cases'}</h2>
          )}
          {showCount && (
            <div style={{ fontSize: 13, color: '#888' }}>
              Showing {paginated.length} of {filtered.length} assigned cases {searchTerm && `(filtered from ${cases.length})`}
            </div>
          )}
        </div>
        <input
          type="text"
          placeholder={isAdminView ? 'Search by QC ID, Hospital, or Radiologist...' : 'Search by QC ID...'}
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
                  {/* Radiologist and Email are only meaningful in the cross-hospital
                      admin history. A radiologist is looking at their own cases. */}
                  {isAdminView && (
                    <>
                      <th style={thStyle}>Radiologist</th>
                      <th style={thStyle}>Email</th>
                    </>
                  )}
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isAdminView ? paginated.map((a) => (
                  <tr key={a.assignment_id} style={rowStyle}>
                    <td style={tdStyle}>{a.qc_subject_id}</td>
                    <td style={tdStyle}>{a.radiologist_name || '-'}</td>
                    <td style={tdStyle}>{a.radiologist_email || '-'}</td>
                    <td style={statusCellStyle(a.status)}>{a.status}</td>
                    <td style={tdStyle}>
                      {a.review_notes ? (
                        <button style={linkButtonStyle} onClick={() => setReasonModal(a)}>View Reason</button>
                      ) : (
                        <span style={{ color: '#aaa' }}>-</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {a.session_id ? (
                        <button onClick={() => fetchSessionDetail(a.session_id, { qc_subject_id: a.qc_subject_id, case_id: a.assessment_id, status: a.status, hospital_name: a.hospital_name })} style={linkButtonStyle}>
                          View Case
                        </button>
                      ) : (
                        <span style={{ color: '#aaa' }}>-</span>
                      )}
                    </td>
                  </tr>
                )) : paginated.map((c) => (
                  <tr key={c.case_id} style={rowStyle}>
                    <td style={tdStyle}>{c.qc_subject_id}</td>
                    <td style={statusCellStyle(c.status)}>{c.status}</td>
                    <td style={tdStyle}>
                      {c.review_notes ? (
                        <button style={linkButtonStyle} onClick={() => setReasonModal(c)}>View Reason</button>
                      ) : (
                        <span style={{ color: '#aaa' }}>-</span>
                      )}
                    </td>
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

      {/* Full-screen case view. Sits above the app header and the admin tab strip,
          so the case fills the viewport with no chrome behind it. The admin's
          read-only "Radiologist History" view keeps the passive display; the
          radiologist's own view gets the interactive per-image DICOM viewer. */}
      {isCaseViewOpen && selectedSession && (
        isAdminView ? (
          <div style={caseViewStyle}>
            <div style={caseViewHeaderStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                <button style={backButtonStyle} onClick={closeCaseView}>&#8592; Back to cases</button>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 17, color: '#233' }}>QC ID: {selectedCase?.qc_subject_id}</h3>
                  {selectedCase?.hospital_name && (
                    <div style={{ fontSize: 12.5, color: '#7c8a8d', marginTop: 2 }}>{selectedCase.hospital_name}</div>
                  )}
                </div>
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
                />
              </div>
            </div>
          </div>
        ) : (
          <DicomCaseViewer
            initialCaseItem={selectedCase}
            initialSessionDetail={selectedSession}
            assignedCases={cases}
            onClose={() => { closeCaseView(); fetchCases(); }}
          />
        )
      )}

      {reasonModal && (
        <div style={modalOverlayStyle} onClick={() => setReasonModal(null)}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Reason — QC ID: {reasonModal.qc_subject_id}</h3>
            <ul style={reasonListStyle}>
              {splitReasons(reasonModal.review_notes).map((reason, i) => (
                <li key={i} style={reasonListItemStyle}>{reason}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={primaryDialogBtnStyle} onClick={() => setReasonModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isEmbedded) {
    return content;
  }

  return (
    <Layout userRole="radiologist" handleLogout={handleLogout} fullWidth={true}>
      {content}
    </Layout>
  );
};

const contentStyle = {
  backgroundColor: '#fff',
  padding: '20px',
  minHeight: '400px',
};

const tableContainerStyle = {
  overflowX: 'auto'
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '10px'
};

const headerRowStyle = {
  backgroundColor: '#f8f9fa',
  borderBottom: '2px solid #dee2e6'
};

const thStyle = {
  padding: '12px',
  textAlign: 'center',
  color: '#495057',
  fontWeight: '600'
};

const rowStyle = {
  borderBottom: '1px solid #dee2e6'
};

const tdStyle = {
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
};

const STATUS_COLORS = { Completed: 'green', 'In-Progress': '#1c5f8f' };

const statusCellStyle = (status) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: STATUS_COLORS[status] || '#b0691c',
  fontWeight: 'bold',
});

/* ---------- Full-screen case view ---------- */

// 2000 clears the app header and the admin tab strip; dialogs sit at 2100.
const caseViewStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '#fff',
  zIndex: 2000,
  display: 'flex',
  flexDirection: 'column',
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

const caseViewBodyStyle = {
  flex: 1,
  overflowY: 'auto',
  background: '#f7fafa',
};

const caseViewInnerStyle = {
  width: '100%',
  padding: 'clamp(16px, 3vw, 32px)',
  boxSizing: 'border-box',
};

const backButtonStyle = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1.5px solid #c8e0e2',
  background: '#fff',
  color: '#14868C',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const confirmDialogStyle = {
  backgroundColor: '#fff',
  width: '90%',
  maxWidth: 440,
  borderRadius: 10,
  padding: 24,
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
};

const reasonListStyle = {
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const reasonListItemStyle = {
  position: 'relative',
  paddingLeft: 16,
  color: '#495057',
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  borderLeft: '3px solid #d7ecec',
};

const primaryDialogBtnStyle = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#14868C',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const linkButtonStyle = {
  background: 'none',
  border: 'none',
  color: '#14868C',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: '0',
  fontSize: '14px'
};

const paginationBtnStyle = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #c8e0e2',
  background: '#fff',
  color: '#14868C',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// Dialogs sit above the full-screen case view (zIndex 2000).
const modalOverlayStyle = {
  position: 'fixed',
  top: '0',
  left: '0',
  right: '0',
  bottom: '0',
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 2100
};

export default RadiologistPage;