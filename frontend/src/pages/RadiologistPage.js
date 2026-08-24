import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DoctorAssessmentForm from '../components/DoctorAssessmentForm';

const RISK_COLORS = { Baseline: '#6ee7b7', Evident: '#fde047', Significant: '#fb923c', High: '#fb7185' };
const riskLabel = (risk) => (risk ? risk.replace(' Risk', '') : null);

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewStage, setReviewStage] = useState(null); // null | 'confirm' | 'notes' | 'reason'
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewError, setReviewError] = useState(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reasonModal, setReasonModal] = useState(null);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!isEmbedded) {
      const token = localStorage.getItem('token');
      if (!token || (role !== 'radiologist' && role !== 'admin')) {
        navigate('/qc/login');
        return;
      }
    }
    fetchCases();
  }, [navigate, isEmbedded]);

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
        setIsModalOpen(true);
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

  const closeReviewDialog = () => {
    setReviewStage(null);
    setReviewNotes('');
    setReviewError(null);
  };

  const handleSubmitReview = async () => {
    const isFlag = reviewStage === 'reason';
    if (!reviewNotes.trim()) {
      setReviewError(isFlag ? 'A reason is required.' : 'Review notes are required.');
      return;
    }
    try {
      setReviewSubmitting(true);
      setReviewError(null);
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const endpoint = isFlag ? 'flag' : 'complete';
      const response = await fetch(`${apiUrl}/api/v1/qc/radiologist/cases/${selectedCase.case_id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: reviewNotes.trim() }),
      });
      if (response.ok) {
        closeReviewDialog();
        setIsModalOpen(false);
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
    navigate('/qc/login');
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
    return (c.qc_subject_id || '').toLowerCase().includes(term)
      || (c.hospital || '').toLowerCase().includes(term);
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const content = (
    <div style={contentStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ color: '#333', margin: 0 }}>{isAdminView ? 'Radiologist History — Assigned Cases' : 'Radiologist Dashboard — Assigned Cases'}</h2>
        <input
          type="text"
          placeholder={isAdminView ? 'Search by QC ID, Hospital, or Radiologist...' : 'Search by QC ID or Hospital...'}
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
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
            Showing {paginated.length} of {filtered.length} assigned cases {searchTerm && `(filtered from ${cases.length})`}
          </div>
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={thStyle}>QC ID</th>
                  <th style={thStyle}>Radiologist</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Hospital</th>
                  <th style={thStyle}>Case/Study</th>
                  <th style={thStyle}>Risk</th>
                  <th style={thStyle}>Assessment</th>
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
                    <td style={tdStyle}>{a.hospital_name || '-'}</td>
                    <td style={tdStyle}>{a.assessment_id}</td>
                    <td style={tdStyle}><RiskBadge risk={a.risk_category} /></td>
                    <td style={{ ...tdStyle, color: a.has_assessment ? 'green' : '#b0691c', fontWeight: 600 }}>
                      {a.has_assessment ? 'Yes' : 'No'}
                    </td>
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
                        <button onClick={() => fetchSessionDetail(a.session_id, { qc_subject_id: a.qc_subject_id, case_id: a.assessment_id, status: a.status })} style={linkButtonStyle}>
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
                    <td style={tdStyle}>{localStorage.getItem('userName') || '-'}</td>
                    <td style={tdStyle}>{localStorage.getItem('userEmail') || '-'}</td>
                    <td style={tdStyle}>{c.hospital || '-'}</td>
                    <td style={tdStyle}>{c.case_id}</td>
                    <td style={tdStyle}><RiskBadge risk={c.risk_category} /></td>
                    <td style={{ ...tdStyle, color: c.has_assessment ? 'green' : '#b0691c', fontWeight: 600 }}>
                      {c.has_assessment ? 'Yes' : 'No'}
                    </td>
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

      {isModalOpen && selectedSession && (
        <div style={modalOverlayStyle} onClick={() => setIsModalOpen(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3>Case for QC ID: {selectedCase?.qc_subject_id}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {role === 'radiologist' && (
                  selectedCase?.status === 'Completed' ? (
                    <span style={completedBadgeStyle}>Completed</span>
                  ) : (
                    <button style={reviewButtonStyle} onClick={() => setReviewStage('confirm')}>
                      Review
                    </button>
                  )
                )}
                <button style={closeButtonStyle} onClick={() => setIsModalOpen(false)}>&times;</button>
              </div>
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
                  {selectedSession.responses && selectedSession.responses.length > 0 ? (
                    selectedSession.responses.map((resp) => (
                      <tr key={resp.qc_id}>
                        <td style={qaTdStyle}>{resp.qc_question}</td>
                        <td style={qaTdStyle}>{resp.qc_answer}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="2" style={qaTdStyle}>No responses found for this session.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <DoctorAssessmentForm
                sessionId={selectedSession.qc_id}
                initialData={selectedSession.assessment}
                onSaveSuccess={() => {
                  fetchCases();
                  setTimeout(() => setIsModalOpen(false), 2000);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {reviewStage === 'confirm' && (
        <div style={modalOverlayStyle} onClick={closeReviewDialog}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Confirm Review</h3>
            <p style={{ color: '#495057' }}>
              Are you sure you want to review and complete QC ID: {selectedCase?.qc_subject_id}?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button style={secondaryDialogBtnStyle} onClick={() => setReviewStage('reason')}>No</button>
              <button style={primaryDialogBtnStyle} onClick={() => setReviewStage('notes')}>Yes</button>
            </div>
          </div>
        </div>
      )}

      {(reviewStage === 'notes' || reviewStage === 'reason') && (
        <div style={modalOverlayStyle} onClick={closeReviewDialog}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{reviewStage === 'reason' ? 'Reason' : 'Review Notes'}</h3>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#495057', marginBottom: 6 }}>
              {reviewStage === 'reason' ? 'Reason' : 'Notes'} <span style={{ color: '#dc3545' }}>*</span>
            </label>
            <textarea
              autoFocus
              style={reviewTextareaStyle}
              value={reviewNotes}
              onChange={(e) => { setReviewNotes(e.target.value); setReviewError(null); }}
              placeholder={reviewStage === 'reason'
                ? "Explain why this case isn't ready to be completed..."
                : "Enter your review notes before completing this case..."}
            />
            {reviewError && <p style={{ color: 'red', fontSize: 13, marginTop: 6 }}>{reviewError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button style={secondaryDialogBtnStyle} onClick={closeReviewDialog} disabled={reviewSubmitting}>Cancel</button>
              <button style={primaryDialogBtnStyle} onClick={handleSubmitReview} disabled={reviewSubmitting}>
                {reviewSubmitting ? 'Saving...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reasonModal && (
        <div style={modalOverlayStyle} onClick={() => setReasonModal(null)}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Reason — QC ID: {reasonModal.qc_subject_id}</h3>
            <p style={{ color: '#495057', whiteSpace: 'pre-wrap' }}>{reasonModal.review_notes}</p>
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

const statusCellStyle = (status) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: status === 'Completed' ? 'green' : '#b0691c',
  fontWeight: 'bold',
});

const reviewButtonStyle = {
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#14868C',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const completedBadgeStyle = {
  padding: '4px 12px',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 600,
  backgroundColor: '#e3f5e9',
  color: '#1e7e4b',
};

const confirmDialogStyle = {
  backgroundColor: '#fff',
  width: '90%',
  maxWidth: 440,
  borderRadius: 10,
  padding: 24,
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
};

const reviewTextareaStyle = {
  width: '100%',
  minHeight: 100,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const secondaryDialogBtnStyle = {
  padding: '9px 18px',
  borderRadius: 8,
  border: '1px solid #c8e0e2',
  background: '#fff',
  color: '#495057',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
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
  zIndex: 1000
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

const modalBodyStyle = {
  padding: '20px',
  overflowY: 'auto'
};

const closeButtonStyle = {
  background: 'none',
  border: 'none',
  fontSize: '24px',
  cursor: 'pointer',
  color: '#666'
};

const qaTableStyle = {
  width: '100%',
  borderCollapse: 'collapse'
};

const qaThStyle = {
  textAlign: 'left',
  padding: '10px',
  borderBottom: '2px solid #dee2e6',
  backgroundColor: '#f8f9fa'
};

const qaTdStyle = {
  padding: '10px',
  borderBottom: '1px solid #eee'
};

export default RadiologistPage;