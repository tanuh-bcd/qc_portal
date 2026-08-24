import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DoctorAssessmentForm from '../components/DoctorAssessmentForm';

const DoctorPage = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sortStack, setSortStack] = useState([{ key: 'date', dir: 'desc' }]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedInstitutions, setExpandedInstitutions] = useState({});
  const [institutionPages, setInstitutionPages] = useState({});
  const [hospitalSummary, setHospitalSummary] = useState([]);
  const [hospitalSessions, setHospitalSessions] = useState({});
  const [hospitalSessionsLoading, setHospitalSessionsLoading] = useState({});
  const PAGE_SIZE = 20;
  const isSuperViewer = localStorage.getItem('isSuperViewer') === 'true';

  const toggleInstitution = (name) => {
    setExpandedInstitutions(prev => {
      const nowExpanded = !prev[name];
      if (nowExpanded && !hospitalSessions[name]) {
        fetchHospitalSessions(name);
      }
      return { ...prev, [name]: nowExpanded };
    });
  };

  const expandAll = () => {
    const allExpanded = {};
    hospitalSummary.forEach(h => { allExpanded[h.hospital_name] = true; });
    setExpandedInstitutions(allExpanded);
    hospitalSummary.forEach(h => {
      if (!hospitalSessions[h.hospital_name]) fetchHospitalSessions(h.hospital_name);
    });
  };

  const collapseAll = () => {
    setExpandedInstitutions({});
  };

  const setInstitutionPage = (name, page) => {
    setInstitutionPages(prev => ({ ...prev, [name]: page }));
  };

  useEffect(() => {
    if (!isEmbedded) {
      const role = localStorage.getItem('role')?.toLowerCase();
      const token = localStorage.getItem('token');
      if (!token || (role !== 'clinician' && role !== 'admin')) {
        navigate('/login');
        return;
      }
    }
    if (isSuperViewer) {
      fetchHospitalSummary();
    } else {
      fetchSessions();
    }
  }, [navigate, isEmbedded]);

  const fetchHospitalSummary = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      if (!token) { setError('Authentication token missing.'); setLoading(false); return; }
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/doctor/hospital-summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setHospitalSummary(await response.json());
      } else {
        setError('Failed to fetch hospital summary');
      }
    } catch (err) {
      setError('An error occurred while fetching hospital summary');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHospitalSessions = async (hospitalName) => {
    try {
      setHospitalSessionsLoading(prev => ({ ...prev, [hospitalName]: true }));
      const token = localStorage.getItem('token');
      if (!token) return;
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const sortQuery = sortStack.map(s => `${s.key}:${s.dir}`).join(',');
      const response = await fetch(
        `${apiUrl}/api/v1/doctor/sessions?sort=${encodeURIComponent(sortQuery)}&hospital_name=${encodeURIComponent(hospitalName)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setHospitalSessions(prev => ({ ...prev, [hospitalName]: data }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setHospitalSessionsLoading(prev => ({ ...prev, [hospitalName]: false }));
    }
  };

  const fetchSessions = async (sortParam) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Authentication token missing. Please log in again.');
        setLoading(false);
        return;
      }
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const sortQuery = sortParam || sortStack.map(s => `${s.key}:${s.dir}`).join(',');
      let url = `${apiUrl}/api/v1/doctor/sessions?sort=${encodeURIComponent(sortQuery)}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const errorData = await response.json();
          setError(errorData.detail || 'Failed to fetch sessions');
        } else {
          const errorText = await response.text();
          console.error("Non-JSON error response:", errorText);
          setError(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      setError('An error occurred while fetching sessions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetail = async (sessionId) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Authentication token missing. Please log in again.');
        return;
      }
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/doctor/sessions/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedSession(data);
        setIsModalOpen(true);
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const errorData = await response.json();
          alert(`Failed to fetch session details: ${errorData.detail || 'Unknown error'}`);
        } else {
          const errorText = await response.text();
          console.error("Non-JSON error response:", errorText);
          alert(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while fetching session details');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('hospitalName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('isSuperViewer');
    navigate('/login');
  };

  const convertGcsToHttp = (gcsUrl) => {
    if (!gcsUrl) return null;
    if (gcsUrl.startsWith('gs://')) {
      const path = gcsUrl.replace('gs://', '');
      return `https://storage.googleapis.com/${path}`;
    }
    return gcsUrl;
  };

  const RISK_COLORS = { 'Baseline Risk': '#6ee7b7', 'Evident Risk': '#fde047', 'Significant Risk': '#fb923c', 'High Risk': '#fb7185' };

  const handleSort = (key) => {
    setSortStack(prev => {
      const existing = prev.find(s => s.key === key);
      let newStack;
      if (existing) {
        newStack = prev.map(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s);
      } else {
        newStack = [...prev, { key, dir: 'asc' }];
        if (newStack.length > 3) newStack = newStack.slice(-3);
      }
      const sortQuery = newStack.map(s => `${s.key}:${s.dir}`).join(',');
      fetchSessions(sortQuery);
      return newStack;
    });
  };

  const clearSort = () => {
    const defaultSort = [{ key: 'date', dir: 'desc' }];
    setSortStack(defaultSort);
    fetchSessions('date:desc');
  };

  const sortArrow = (key) => {
    const entry = sortStack.find(s => s.key === key);
    if (!entry) return ' ⇅';
    const pos = sortStack.indexOf(entry) + 1;
    const arrow = entry.dir === 'asc' ? '↑' : '↓';
    return ` ${arrow}${sortStack.length > 1 ? pos : ''}`;
  };

  const renderSessionTable = (sessionList, showHospitalCol) => (
    <div style={tableContainerStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headerRowStyle}>
            <th style={thCenterStyle}>Subject ID</th>
            {showHospitalCol && <th style={thCenterStyle}>Hospital</th>}
            <th style={sortableThStyle} onClick={() => handleSort('date')}>Date{sortArrow('date')}</th>
            <th style={thCenterStyle}>Risk</th>
            <th style={sortableThStyle} onClick={() => handleSort('assessment')}>Assessment{sortArrow('assessment')}</th>
            {/* <th style={thCenterStyle}>Mammography</th>
            <th style={thCenterStyle}>Mammography Report</th>
            <th style={thCenterStyle}>Breast Ultrasound (USG Breast)</th>
            <th style={thCenterStyle}>Breast Ultrasound (USG Breast) Report</th> */}
             <th style={thCenterStyle}>Mammography + Report</th>
            <th style={thCenterStyle}>Breast Ultrasound + Report</th>
            <th style={thCenterStyle}>Biopsy</th>
            <th style={thCenterStyle}>Annotations</th>
            <th style={thCenterStyle}>Additional Docs</th>
            <th style={thCenterStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessionList.map((session) => (
            <tr key={session.id} style={rowStyle}>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{session.patient_id || session.id?.substring(0, 8)}</td>
              {showHospitalCol && <td style={{ ...tdStyle, textAlign: 'center', fontSize: 12 }}>{session.hospital_name || '-'}</td>}
              <td style={{ ...tdStyle, textAlign: 'center', fontSize: 12 }}>{session.consent_timestamp ? new Date(session.consent_timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {session.risk_category ? (
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: RISK_COLORS[session.risk_category] || '#eee',
                    color: '#111',
                  }}>{session.risk_category.replace(' Risk', '')}</span>
                ) : '-'}
              </td>
              <td style={statusCellStyle(session.has_assessment)}>
                {session.has_assessment ? 'Yes' : 'No'}
              </td>
              {/* <td style={statusCellStyle(session.has_mammo_dicom)}>
                {session.has_mammo_dicom ? 'Yes' : 'No'}
              </td>
              <td style={smrCellStyle(session.has_mammo_reading)}>
                {session.has_mammo_reading === 'SMR' ? 'Yes (SMR)' : session.has_mammo_reading === 'Yes' ? 'Yes' : 'No'}
              </td>
              <td style={smrCellStyle(session.has_us_video)}>
                {session.has_us_video === 'SMR' ? 'Yes (SMR)' : session.has_us_video === 'Yes' ? 'Yes' : 'No'}
              </td>
              <td style={smrCellStyle(session.has_us_reading)}>
                {session.has_us_reading === 'SMR' ? 'Yes (SMR)' : session.has_us_reading === 'Yes' ? 'Yes' : 'No'}
              </td> */}
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {(() => {
                  const isSMR = session.has_mammo_reading === 'SMR';
                  const isYes = session.has_mammo_dicom && (session.has_mammo_reading === 'Yes' || isSMR);
                  return (
                    <span style={{
                      color: isSMR ? '#0d6efd' : isYes ? 'green' : 'red',
                      fontWeight: 'bold',
                      fontSize: isSMR ? 12 : 'inherit',
                    }}>
                      {isSMR ? 'Yes (SMR)' : isYes ? 'Yes' : 'No'}
                    </span>
                  );
                })()}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {(() => {
                  const isSMR = session.has_us_reading === 'SMR';
                  const isYes = (session.has_us_video === 'Yes' || session.has_us_video === 'SMR')
                    && (session.has_us_reading === 'Yes' || isSMR);
                  return (
                    <span style={{
                      color: isSMR ? '#0d6efd' : isYes ? 'green' : 'red',
                      fontWeight: 'bold',
                      fontSize: isSMR ? 12 : 'inherit',
                    }}>
                      {isSMR ? 'Yes (SMR)' : isYes ? 'Yes' : 'No'}
                    </span>
                  );
                })()}
              </td>
              <td style={statusCellStyle(session.has_biopsy)}>
                {session.has_biopsy ? 'Yes' : 'No'}
              </td>
              <td style={statusCellStyle(session.has_annotations)}>
                {session.has_annotations ? 'Yes' : 'No'}
              </td>
              <td style={statusCellStyle(session.has_additional_docs)}>
                {session.has_additional_docs ? 'Yes' : 'No'}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                <button
                  onClick={() => fetchSessionDetail(session.id)}
                  style={linkButtonStyle}
                >
                  {!isSuperViewer && session.has_assessment ? 'Edit Assessment' : 'View Responses'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 12, color: '#666', textAlign: 'right' }}>
        <span style={{ color: '#0d6efd', fontWeight: 600 }}>SMR</span> — Breast Ultrasound (USG Breast) Report
      </div>
    </div>
  );

  const renderPagination = (totalItems, curPage, onPageChange) => {
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (totalPages <= 1) return null;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 16 }}>
        <button
          onClick={() => onPageChange(Math.max(1, curPage - 1))}
          disabled={curPage === 1}
          style={{ ...paginationBtnStyle, opacity: curPage === 1 ? 0.4 : 1 }}
        >Prev</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - curPage) <= 2)
          .reduce((acc, p, idx, arr) => {
            if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === '...' ? <span key={`dot-${i}`} style={{ color: '#999', fontSize: 13 }}>...</span> :
            <button
              key={p}
              onClick={() => onPageChange(p)}
              style={{ ...paginationBtnStyle, background: curPage === p ? '#14868C' : '#fff', color: curPage === p ? '#fff' : '#14868C', borderColor: curPage === p ? '#14868C' : '#c8e0e2' }}
            >{p}</button>
          )}
        <button
          onClick={() => onPageChange(Math.min(totalPages, curPage + 1))}
          disabled={curPage === totalPages}
          style={{ ...paginationBtnStyle, opacity: curPage === totalPages ? 0.4 : 1 }}
        >Next</button>
      </div>
    );
  };

  const renderHospitalSummary = () => {
    const totalSubjects = hospitalSummary.reduce((sum, h) => sum + h.subject_count, 0);

    const filtered = hospitalSummary.filter(h => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return h.hospital_name.toLowerCase().includes(term)
        || (h.short_name || '').toLowerCase().includes(term)
        || (h.state || '').toLowerCase().includes(term);
    });

    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#888' }}>
            {filtered.length} institution{filtered.length !== 1 ? 's' : ''}, {totalSubjects} total subjects
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={expandAll} style={accordionToggleBtnStyle}>Expand All</button>
            <button onClick={collapseAll} style={accordionToggleBtnStyle}>Collapse All</button>
          </div>
        </div>
        {filtered.map((h) => (
          <div key={h.hospital_name} style={accordionCardStyle}>
            <div style={accordionHeaderStyle} onClick={() => toggleInstitution(h.hospital_name)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, color: '#14868C', transition: 'transform 0.2s', display: 'inline-block', transform: expandedInstitutions[h.hospital_name] ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                <span style={{ fontWeight: 600, color: '#333', fontSize: 14 }}>{h.hospital_name}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={accordionBadgeStyle('#e8f7f8', '#14868C')}>
                  {h.subject_count} subject{h.subject_count !== 1 ? 's' : ''}
                </span>
                <span style={accordionBadgeStyle(h.assessment_count > 0 ? '#e6f9e6' : '#fef2f2', h.assessment_count > 0 ? '#16a34a' : '#dc2626')}>
                  {h.assessment_count} assessment{h.assessment_count !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            {expandedInstitutions[h.hospital_name] && (
              <div style={{ padding: '12px 16px' }}>
                {hospitalSessionsLoading[h.hospital_name] && <p style={{ fontSize: 13, color: '#888' }}>Loading sessions...</p>}
                {hospitalSessions[h.hospital_name] && hospitalSessions[h.hospital_name].length === 0 && (
                  <p style={{ fontSize: 13, color: '#888' }}>No sessions found for this institution.</p>
                )}
                {hospitalSessions[h.hospital_name] && hospitalSessions[h.hospital_name].length > 0 && (() => {
                  const instSessions = hospitalSessions[h.hospital_name];
                  const instPage = institutionPages[h.hospital_name] || 1;
                  const totalPages = Math.ceil(instSessions.length / PAGE_SIZE);
                  const paginated = instSessions.slice((instPage - 1) * PAGE_SIZE, instPage * PAGE_SIZE);
                  return (
                    <>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{instSessions.length} subject{instSessions.length !== 1 ? 's' : ''}</div>
                      {renderSessionTable(paginated, false)}
                      {renderPagination(instSessions.length, instPage, (p) => setInstitutionPage(h.hospital_name, p))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No institutions match "{searchTerm}".</p>
        )}
      </>
    );
  };

  const content = (
    <div style={contentStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ color: '#333', margin: 0 }}>Subject List</h2>
          {!isSuperViewer && sortStack.map((s, i) => (
            <span key={i} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, backgroundColor: '#e8f7f8', color: '#14868C', fontWeight: 600 }}>
              {s.key}{s.dir === 'asc' ? '↑' : '↓'}
            </span>
          ))}
          {!isSuperViewer && sortStack.length > 1 && (
            <button onClick={clearSort} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', color: '#666' }}>
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder={isSuperViewer ? 'Search by Subject ID or Institution...' : 'Search by Subject ID...'}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            style={{ width: 260, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #c8e0e2', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && isSuperViewer && renderHospitalSummary()}

      {(() => {
        if (isSuperViewer) return null;

        const filtered = sessions.filter(s => {
          if (!searchTerm) return true;
          const term = searchTerm.toLowerCase();
          return (s.patient_id || '').toLowerCase().includes(term)
            || (s.id || '').toLowerCase().includes(term);
        });

        if (!loading && !error && sessions.length === 0) return <p>No sessions found.</p>;
        if (!loading && !error && filtered.length === 0) return <p>No subjects match "{searchTerm}".</p>;

        if (!loading && !error && filtered.length > 0) {
          const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
          const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

          return (
            <>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Showing {paginated.length} of {filtered.length} subjects {searchTerm && `(filtered from ${sessions.length})`}</div>
              {renderSessionTable(paginated, false)}
              {renderPagination(filtered.length, currentPage, setCurrentPage)}
            </>
          );
        }

        return null;
      })()}

      {isModalOpen && selectedSession && (
        <div style={modalOverlayStyle} onClick={() => setIsModalOpen(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3>Responses for Subject ID: {selectedSession.patient_id || selectedSession.id}</h3>
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
                  {selectedSession.responses && selectedSession.responses.length > 0 ? (
                    selectedSession.responses.map((resp) => (
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
              
              {isSuperViewer ? (
                selectedSession.assessment ? (
                  <DoctorAssessmentForm
                    sessionId={selectedSession.id}
                    initialData={selectedSession.assessment}
                    readOnly={true}
                    snehithaRisk={(() => {
                      if (!selectedSession.responses) return null;
                      const r = {};
                      selectedSession.responses.forEach(resp => { r[resp.question] = resp.answer; });
                      const age = parseInt(r['What is your current age? (Please enter a number - years)'] || r['Q1'] || '0') || 0;
                      const aam = parseInt(r['What age were you when you had your first menstrual period? (Please enter a number)'] || r['Q10'] || '0') || 0;
                      const irr = (r['Q12_Current'] === 'No' || r['Are your menstrual cycles regular? - Currently'] === 'No') ? 1 : 0;
                      const bf = (r['Q17'] === 'greater than 24 months' || r['For how long did you breastfeed?'] === 'greater than 24 months') ? 1 : 0;
                      const fh = (r['Q21'] === 'First Order (Mother, Sibling, Father)' || (r['Has anyone in your family been diagnosed with any type of cancer?'] || '').includes('First')) ? 1 : 0;
                      const bx = (r['Q40'] === 'Yes' || r['Have you had a breast biopsy?'] === 'Yes') ? 1 : 0;
                      const nul = (r['Q14'] === 'No' || r['Have you given birth to a child?'] === 'No') ? 1 : 0;
                      const a25 = (r['Q16'] === '25 to 29') ? 1 : 0;
                      const a30 = (r['Q16'] === 'After 30') ? 1 : 0;
                      const ab = (nul || a25) ? 1 : 0;
                      const lp = -0.940 + 0.027 * age - 0.082 * aam + 0.453 * irr - 0.892 * bf + 0.810 * fh + 1.420 * bx + 0.811 * ab + 1.035 * a30;
                      return ((1 / (1 + Math.exp(-lp))) * 100).toFixed(2);
                    })()}
                  />
                ) : (
                  <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 6, backgroundColor: '#f0f4ff', border: '1px solid #c8d8f8', color: '#3a5a9e', fontSize: 13 }}>
                    No assessment has been submitted for this subject yet.
                  </div>
                )
              ) : (
                <DoctorAssessmentForm
                  sessionId={selectedSession.id}
                  initialData={selectedSession.assessment}
                  snehithaRisk={(() => {
                    if (!selectedSession.responses) return null;
                    const r = {};
                    selectedSession.responses.forEach(resp => { r[resp.question] = resp.answer; });
                    const age = parseInt(r['What is your current age? (Please enter a number - years)'] || r['Q1'] || '0') || 0;
                    const aam = parseInt(r['What age were you when you had your first menstrual period? (Please enter a number)'] || r['Q10'] || '0') || 0;
                    const irr = (r['Q12_Current'] === 'No' || r['Are your menstrual cycles regular? - Currently'] === 'No') ? 1 : 0;
                    const bf = (r['Q17'] === 'greater than 24 months' || r['For how long did you breastfeed?'] === 'greater than 24 months') ? 1 : 0;
                    const fh = (r['Q21'] === 'First Order (Mother, Sibling, Father)' || (r['Has anyone in your family been diagnosed with any type of cancer?'] || '').includes('First')) ? 1 : 0;
                    const bx = (r['Q40'] === 'Yes' || r['Have you had a breast biopsy?'] === 'Yes') ? 1 : 0;
                    const nul = (r['Q14'] === 'No' || r['Have you given birth to a child?'] === 'No') ? 1 : 0;
                    const a25 = (r['Q16'] === '25 to 29') ? 1 : 0;
                    const a30 = (r['Q16'] === 'After 30') ? 1 : 0;
                    const ab = (nul || a25) ? 1 : 0;
                    const lp = -0.940 + 0.027 * age - 0.082 * aam + 0.453 * irr - 0.892 * bf + 0.810 * fh + 1.420 * bx + 0.811 * ab + 1.035 * a30;
                    return ((1 / (1 + Math.exp(-lp))) * 100).toFixed(2);
                  })()}
                  onSaveSuccess={() => {
                    fetchSessions();
                    setTimeout(() => setIsModalOpen(false), 2000);
                  }}
                />
              )}
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
    <Layout 
      userRole="clinician" 
      handleLogout={handleLogout} 
      fullWidth={true}
    >
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

const headerRowStyle = {
  backgroundColor: '#f8f9fa',
  borderBottom: '2px solid #dee2e6'
};

const thStyle = {
  padding: '12px',
  textAlign: 'left',
  color: '#495057',
  fontWeight: '600'
};

const thCenterStyle = {
  padding: '12px',
  textAlign: 'center',
  color: '#495057',
  fontWeight: '600'
};

const sortableThStyle = {
  padding: '12px',
  textAlign: 'center',
  color: '#14868C',
  fontWeight: '600',
  cursor: 'pointer',
  userSelect: 'none',
};

const smrCellStyle = (val) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: val === 'SMR' ? '#0d6efd' : val === 'Yes' ? 'green' : 'red',
  fontWeight: 'bold',
  fontSize: val === 'SMR' ? 12 : 'inherit',
});

const statusCellStyle = (isTrue) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'center',
  color: isTrue ? 'green' : 'red',
  fontWeight: 'bold',
});

const rowStyle = {
  borderBottom: '1px solid #dee2e6'
};

const tdStyle = {
  padding: '12px',
  verticalAlign: 'middle'
};

const thumbnailStyle = {
  width: '50px',
  height: '50px',
  objectFit: 'cover',
  borderRadius: '4px',
  cursor: 'pointer',
  border: '1px solid #ddd'
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

const accordionCardStyle = {
  border: '1px solid #e0e7eb',
  borderRadius: 10,
  marginBottom: 10,
  overflow: 'hidden',
  backgroundColor: '#fff',
};

const accordionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 16px',
  cursor: 'pointer',
  backgroundColor: '#f8fafb',
  borderBottom: '1px solid #e0e7eb',
  userSelect: 'none',
};

const accordionBadgeStyle = (bg, color) => ({
  fontSize: 12,
  padding: '4px 12px',
  borderRadius: 12,
  backgroundColor: bg,
  color: color,
  fontWeight: 600,
});

const accordionToggleBtnStyle = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #c8e0e2',
  background: '#fff',
  color: '#14868C',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default DoctorPage;
