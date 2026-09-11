import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Sidebar from '../components/Sidebar';
import MammoTechDashboardHome from '../components/MammoTechDashboardHome';
import MammoTechCaseViewer from '../components/MammoTechCaseViewer';

const CASE_VIEW_STORAGE_KEY = 'qc_mammotech_case_view_state';
const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'cases', label: 'Assigned Cases' },
];

const STATUS_BADGE_COLORS = {
  Pending: { background: '#fdf0da', color: '#b0691c' },
  'In-Progress': { background: '#e3f0fb', color: '#1c5f8f' },
  Completed: { background: '#e3f5e9', color: '#1e7e4b' },
  Rejected: { background: '#fbe3e3', color: '#9f1c1c' },
};

const UNKNOWN_STATUS_COLORS = { background: '#eceff1', color: '#546e7a' };

const StatusBadge = ({ status }) => {
  if (!status) return <span style={{ color: '#aaa' }}>—</span>;
  const key = Object.keys(STATUS_BADGE_COLORS).find(
    k => k.toLowerCase() === status.toString().toLowerCase()
  );
  const colors = key ? STATUS_BADGE_COLORS[key] : UNKNOWN_STATUS_COLORS;
  return <span style={{ ...statusBadgeStyle, ...colors }}>{status}</span>;
};

const formatIST = (utcString) =>
  new Date(utcString + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

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
  const [view, setView] = useState('dashboard');
  const PAGE_SIZE = 10;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const role = (localStorage.getItem('role') || '').toLowerCase();
    if (!token || role !== 'mammo tech') {
      navigate('/');
      return;
    }
    fetchCases();

    const saved = sessionStorage.getItem(CASE_VIEW_STORAGE_KEY);
    if (saved) {
      try {
        const { sessionId, caseItem } = JSON.parse(saved);
        if (sessionId && caseItem) {
          setView('cases');
          fetchSessionDetail(sessionId, caseItem);
        }
      } catch {
        sessionStorage.removeItem(CASE_VIEW_STORAGE_KEY);
      }
    }
  }, [navigate]);

  const fetchCases = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/mammo-tech/cases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setCases(data.cases || []);
        setError(null);
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
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/doctor/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
    const fields = [c.qc_subject_id, c.status, c.submitted_response, c.assigned_radiologist_name, formatIST(c.assigned_at)];
    return fields.some(f => (f || '').toString().toLowerCase().includes(term));
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > pages) setCurrentPage(pages);
  }, [filtered.length, currentPage]);

  const showCount = !loading && !error && filtered.length > 0;

  return (
    <Layout
      userRole="mammo tech"
      handleLogout={handleLogout}
      fullWidth={true}
      sidebar={<Sidebar items={SIDEBAR_ITEMS} activeId={view} onSelect={setView} />}
    >
      {view === 'dashboard' ? <MammoTechDashboardHome /> : (
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
            placeholder="Search by QC ID, Status, Radiologist, or Date..."
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
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={headerRowStyle}>
                    <th style={thStyle}>QC ID</th>
                    <th style={thStyle}>Assigned At</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Response</th>
                    <th style={thStyle}>Assigned Radiologist</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => (
                    <tr key={c.case_id} style={rowStyle}>
                      <td style={tdStyle}>{c.qc_subject_id}</td>
                      <td style={tdStyle}>{formatIST(c.assigned_at)}</td>
                      <td style={tdStyle}><StatusBadge status={c.status} /></td>
                      <td style={tdStyle}>
                        {c.submitted_response ? (
                          <span style={responseBadgeStyle(c.submitted_response)}>{c.submitted_response}</span>
                        ) : (
                          <span style={{ color: '#aaa' }}>-</span>
                        )}
                      </td>
                      <td style={tdStyle}>{c.assigned_radiologist_name || '—'}</td>
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
          <MammoTechCaseViewer
            initialCaseItem={selectedCase}
            initialSessionDetail={selectedSession}
            assignedCases={cases}
            onClose={() => { closeCaseView(); fetchCases(); }}
          />
        )}
      </div>
      )}
    </Layout>
  );
};

const contentStyle = {
  backgroundColor: '#fff',
  padding: '20px',
  minHeight: '400px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '10px',
};

const headerRowStyle = {
  backgroundColor: '#f8f9fa',
  borderBottom: '2px solid #dee2e6',
};

const thStyle = {
  padding: '12px',
  textAlign: 'center',
  color: '#495057',
  fontWeight: '600',
};

const rowStyle = {
  borderBottom: '1px solid #dee2e6',
};

const tdStyle = {
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
};

const statusBadgeStyle = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
};

// The submitted Yes/No decision — colored green for Yes (sent on), red for
// No (rejected). Mirrors the same coloring used for the Radiologist's grade
// in RadiologistPage.js.
const responseBadgeStyle = (response) => ({
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  backgroundColor: response === 'No' ? '#fbe3e3' : '#e3f5e9',
  color: response === 'No' ? '#9f1c1c' : '#1e7e4b',
});

const linkButtonStyle = {
  background: 'none',
  border: 'none',
  color: '#14868C',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: '0',
  fontSize: '14px',
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

export default MammoTechPage;
