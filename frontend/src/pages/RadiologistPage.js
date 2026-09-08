import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DicomCaseViewer from '../components/DicomCaseViewer';
import MammoTechCaseViewer from '../components/MammoTechCaseViewer';

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

// const fmtDateTime = (value) => {
//   if (!value) return '-';
//   const d = new Date(value);
//   return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
// };

const formatIST = (utcString) =>
  new Date(utcString + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

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

const RadiologistPage = ({ isEmbedded = false, historyRole = 'radiologist' }) => {
  const navigate = useNavigate();
  const role = (localStorage.getItem('role') || '').toLowerCase();
  // Admins (embedded in AdminPage, or viewing the standalone route directly) see the
  // full cross-hospital assignment history instead of a single radiologist's own cases.
  const isAdminView = isEmbedded || role === 'admin';
  const isMammoTechHistory = isAdminView && historyRole === 'mammo_tech';
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
        ? `/api/v1/qc/admin/assignments?for_role=${historyRole}`
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
    const fields = isAdminView
      ? [
          c.qc_subject_id, c.hospital_name, c.status, c.review_notes, c.submitted_response, formatIST(c.assigned_at),
          isMammoTechHistory ? c.mammo_tech_name : c.radiologist_name,
          isMammoTechHistory ? c.mammo_tech_email : c.radiologist_email,
          !isMammoTechHistory ? c.mammo_tech_name : null,
          isMammoTechHistory ? c.assigned_radiologist_name : null,
        ]
      : [c.qc_subject_id, c.status, c.review_notes, c.submitted_response, formatIST(c.assigned_at)];
    return fields.some(f => (f || '').toString().toLowerCase().includes(term));
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const queueCases = isAdminView
    ? cases.map(a => ({ case_id: a.assessment_id, session_id: a.session_id, qc_subject_id: a.qc_subject_id, status: a.status }))
    : cases;

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
            <h2 style={{ color: '#333', margin: 0 }}>
              {isAdminView ? (isMammoTechHistory ? 'Mammo Tech History — Assigned Cases' : 'Radiologist History — Assigned Cases') : 'Assigned Cases'}
            </h2>
          )}
          {showCount && (
            <div style={{ fontSize: 13, color: '#888' }}>
              Showing {paginated.length} of {filtered.length} assigned cases {searchTerm && `(filtered from ${cases.length})`}
            </div>
          )}
        </div>
        <input
          type="text"
          placeholder={isAdminView
            ? (isMammoTechHistory ? 'Search by QC ID, Hospital, Mammo Tech, Status, Date...' : 'Search by QC ID, Hospital, Radiologist, Mammo Tech, Status, Date...')
            : 'Search by QC ID, Status, or Date...'}
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
                  {/* Radiologist/Email/Mammo Tech are only meaningful in the cross-hospital
                      admin history. A radiologist looking at their own cases doesn't need them. */}
                  {isAdminView && !isMammoTechHistory && (
                    <>
                      <th style={thStyle}>Radiologist</th>
                      <th style={thStyle}>Email</th>
                      <th style={thStyle}>Mammo Tech</th>
                    </>
                  )}
                  {isAdminView && isMammoTechHistory && (
                    <>
                      <th style={thStyle}>Mammo Tech</th>
                      <th style={thStyle}>Email</th>
                    </>
                  )}
                  <th style={thStyle}>Assigned At</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Response</th>
                  {isMammoTechHistory && <th style={thStyle}>Assigned Radiologist</th>}
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isAdminView ? paginated.map((a) => (
                  <tr key={a.assignment_id} style={rowStyle}>
                    <td style={tdStyle}>{a.qc_subject_id}</td>
                    {!isMammoTechHistory && (
                      <>
                        <td style={tdStyle}>{a.radiologist_name || '-'}</td>
                        <td style={tdStyle}>{a.radiologist_email || '-'}</td>
                        <td style={tdStyle}>{a.mammo_tech_name || '-'}</td>
                      </>
                    )}
                    {isMammoTechHistory && (
                      <>
                        <td style={tdStyle}>{a.mammo_tech_name || '-'}</td>
                        <td style={tdStyle}>{a.mammo_tech_email || '-'}</td>
                      </>
                    )}
                    <td style={tdStyle}>{formatIST(a.assigned_at)}</td>
                    <td style={statusCellStyle(a.status)}>{a.status}</td>
                    <td style={tdStyle}>
                      {(a.submitted_response || a.review_notes) ? (
                        <button style={linkButtonStyle} onClick={() => setReasonModal(a)}>View Response</button>
                      ) : (
                        <span style={{ color: '#aaa' }}>-</span>
                      )}
                    </td>
                    {isMammoTechHistory && (
                      <td style={tdStyle}>{a.assigned_radiologist_name || '-'}</td>
                    )}
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
                    <td style={tdStyle}>{formatIST(c.assigned_at)}</td>
                    <td style={statusCellStyle(c.status)}>{c.status}</td>
                    <td style={tdStyle}>
                      {(c.submitted_response || c.review_notes) ? (
                        <button style={linkButtonStyle} onClick={() => setReasonModal(c)}>View Response</button>
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

      {isCaseViewOpen && selectedSession && (
        isAdminView ? (
          isMammoTechHistory ? (
            <MammoTechCaseViewer
              initialCaseItem={selectedCase}
              initialSessionDetail={selectedSession}
              assignedCases={queueCases}
              onClose={closeCaseView}
              readOnly
            />
          ) : (
            <DicomCaseViewer
              initialCaseItem={selectedCase}
              initialSessionDetail={selectedSession}
              assignedCases={queueCases}
              onClose={closeCaseView}
              readOnly
            />
          )
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
            <h3 style={{ marginTop: 0 }}>Response — QC ID: {reasonModal.qc_subject_id}</h3>
            {reasonModal.submitted_response && (
              <div style={responseBadgeStyle(reasonModal.submitted_response)}>
                {reasonModal.submitted_response}
              </div>
            )}
            {splitReasons(reasonModal.review_notes).length > 0 && (
              <>
                <div style={reasonSectionLabelStyle}>Reason</div>
                <ul style={reasonListStyle}>
                  {splitReasons(reasonModal.review_notes).map((reason, i) => (
                    <li key={i} style={reasonListItemStyle}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
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

const confirmDialogStyle = {
  backgroundColor: '#fff',
  width: '90%',
  maxWidth: 440,
  borderRadius: 10,
  padding: 24,
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
};
const NEGATIVE_RESPONSES = ['No', 'Bad', 'Not a Mammogram'];
const responseBadgeStyle = (response) => ({
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  margin: '4px 0 0',
  backgroundColor: NEGATIVE_RESPONSES.includes(response) ? '#fbe3e3' : '#e3f5e9',
  color: NEGATIVE_RESPONSES.includes(response) ? '#9f1c1c' : '#1e7e4b',
});

const reasonSectionLabelStyle = {
  marginTop: 14,
  marginBottom: 4,
  fontSize: 12,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
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