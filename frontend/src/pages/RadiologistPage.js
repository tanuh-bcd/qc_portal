import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DoctorAssessmentForm from '../components/DoctorAssessmentForm';
import BreastCaseReviewPanel from '../components/BreastCaseReviewPanel';

const RISK_COLORS = { Baseline: '#6ee7b7', Evident: '#fde047', Significant: '#fb923c', High: '#fb7185' };
const riskLabel = (risk) => (risk ? risk.replace(' Risk', '') : null);

// Legacy (pre-two-stage-review) notes were plain text: either free-form review
// notes, or a checklist of "Not usable: ..." reasons joined one per line (older
// records used '; ' instead). Only used as a read-only fallback for old cases.
const splitReasons = (notes) => {
  const text = String(notes || '').trim();
  if (!text) return [];
  const parts = text.includes('\n') ? text.split(/\r?\n/) : text.split(/;\s*/);
  return parts.map(p => p.trim()).filter(Boolean);
};

// Current-format notes are JSON: {"left": {"accepted": bool, "comment": str|null}, "right": {...}}.
// Returns null for legacy plain-text notes so callers can fall back to splitReasons.
const parseReviewNotes = (notes) => {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === 'object' && (parsed.left || parsed.right) ? parsed : null;
  } catch {
    return null;
  }
};

const describeBreastReview = (side, entry) => {
  if (!entry) return null;
  const label = side === 'left' ? 'Left' : 'Right';
  const verdict = entry.accepted ? 'Accepted' : 'Rejected';
  return entry.comment ? `${label}: ${verdict} — ${entry.comment}` : `${label}: ${verdict}`;
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

const RadiologistPage = ({ isEmbedded = false, roleFilter = 'radiologist' }) => {
  const navigate = useNavigate();
  const role = (localStorage.getItem('role') || '').toLowerCase();
  // Admins (embedded in AdminPage, or viewing the standalone route directly) see the
  // full cross-hospital assignment history instead of a single radiologist's own cases.
  // roleFilter picks which role's assignments that history shows (embedded only) —
  // AdminPage reuses this same component for both the Radiologist and Mammo Tech
  // history tabs instead of duplicating the table.
  const isAdminView = isEmbedded || role === 'admin';
  const assigneeLabel = roleFilter === 'mammotech' ? 'Mammo Tech' : 'Radiologist';
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [isCaseViewOpen, setIsCaseViewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewStage, setReviewStage] = useState(null); // null | 'left' | 'left-comment' | 'right' | 'right-comment'
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
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
  }, [navigate, isEmbedded, roleFilter]);

  useEffect(() => {
    if (!isCaseViewOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !reviewStage && !reasonModal) closeCaseView();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCaseViewOpen, reviewStage, reasonModal]);

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
      const endpoint = isAdminView
        ? `/api/v1/qc/admin/assignments?assignment_role=${roleFilter}`
        : '/api/v1/qc/radiologist/cases';
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

  const closeReviewDialog = () => {
    setReviewStage(null);
    setReviewComment('');
    setReviewError(null);
  };

  // Posts a Left/Right Breast Annotation decision. Yes on Left advances to the
  // Right stage; Yes on Right (or any rejection, which just records the mandatory
  // comment) finishes the dialog and refreshes the case.
  const submitBreastReview = async (side, accepted, comment) => {
    try {
      setReviewSubmitting(true);
      setReviewError(null);
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/radiologist/cases/${selectedCase.case_id}/review-${side}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted, comment: comment || null }),
      });
      if (response.ok) {
        if (side === 'left' && accepted) {
          setReviewComment('');
          setReviewStage('right');
        } else {
          closeReviewDialog();
          closeCaseView();
          fetchCases();
        }
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

  const handleSubmitComment = () => {
    if (!reviewComment.trim()) {
      setReviewError('Comment is required.');
      return;
    }
    const side = reviewStage === 'left-comment' ? 'left' : 'right';
    submitBreastReview(side, false, reviewComment.trim());
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
                  {/* Assignee and Email are only meaningful in the cross-hospital
                      admin history. A radiologist/mammo tech is looking at their own cases. */}
                  {isAdminView && (
                    <>
                      <th style={thStyle}>{assigneeLabel}</th>
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
          so the case fills the viewport with no chrome behind it. */}
      {isCaseViewOpen && selectedSession && (
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {role === 'radiologist' && (
                selectedCase?.status === 'Completed' ? (
                  <span style={completedBadgeStyle}>Completed</span>
                ) : (
                  <button style={reviewButtonStyle} onClick={() => setReviewStage('left')}>
                    Review
                  </button>
                )
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

      {(reviewStage === 'left' || reviewStage === 'right') && (
        <div style={modalOverlayStyle} onClick={closeReviewDialog}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {reviewStage === 'left' ? 'Left Breast Annotation Accepted?' : 'Right Breast Annotation Accepted?'}
            </h3>
            <p style={{ color: '#495057' }}>QC ID: {selectedCase?.qc_subject_id}</p>
            {reviewError && <p style={{ color: 'red', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{reviewError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button
                style={dangerDialogBtnStyle}
                disabled={reviewSubmitting}
                onClick={() => setReviewStage(reviewStage === 'left' ? 'left-comment' : 'right-comment')}
              >
                No
              </button>
              <button
                style={primaryDialogBtnStyle}
                disabled={reviewSubmitting}
                onClick={() => submitBreastReview(reviewStage, true, null)}
              >
                {reviewSubmitting ? 'Saving...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(reviewStage === 'left-comment' || reviewStage === 'right-comment') && (
        <div style={modalOverlayStyle} onClick={closeReviewDialog}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {reviewStage === 'left-comment' ? 'Left Breast Annotation — Comment' : 'Right Breast Annotation — Comment'}
            </h3>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#495057', marginBottom: 6 }}>
              Comment <span style={{ color: '#dc3545' }}>*</span>
            </label>
            <textarea
              autoFocus
              style={reviewTextareaStyle}
              value={reviewComment}
              onChange={(e) => { setReviewComment(e.target.value); setReviewError(null); }}
              placeholder="Describe why the annotation isn't accepted..."
            />
            {reviewError && <p style={{ color: 'red', fontSize: 13, marginTop: 6 }}>{reviewError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button style={secondaryDialogBtnStyle} onClick={closeReviewDialog} disabled={reviewSubmitting}>Cancel</button>
              <button style={primaryDialogBtnStyle} onClick={handleSubmitComment} disabled={reviewSubmitting}>
                {reviewSubmitting ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reasonModal && (
        <div style={modalOverlayStyle} onClick={() => setReasonModal(null)}>
          <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Reason — QC ID: {reasonModal.qc_subject_id}</h3>
            <ul style={reasonListStyle}>
              {(() => {
                const parsed = parseReviewNotes(reasonModal.review_notes);
                if (parsed) {
                  const lines = [describeBreastReview('left', parsed.left), describeBreastReview('right', parsed.right)]
                    .filter(Boolean);
                  return lines.map((line, i) => <li key={i} style={reasonListItemStyle}>{line}</li>);
                }
                return splitReasons(reasonModal.review_notes).map((reason, i) => (
                  <li key={i} style={reasonListItemStyle}>{reason}</li>
                ));
              })()}
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

const STATUS_COLORS = {
  Completed: 'green',
  Accepted: 'green',
  'In-Progress': '#2563eb',
  Rejected: '#dc3545',
};

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

const dangerDialogBtnStyle = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#dc3545',
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