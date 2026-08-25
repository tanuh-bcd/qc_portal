import React, { useEffect, useState } from 'react';
import DoctorAssessmentForm from './DoctorAssessmentForm';

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

const AssignRadiologistHistory = () => {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reasonModal, setReasonModal] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const PAGE_SIZE = 20;

  useEffect(() => {
    fetchAssignments();
  }, []);

  const fetchAssignments = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/admin/assignments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAssignments(data || []);
      } else {
        const contentType = response.headers.get('content-type');
        const errorData = contentType && contentType.indexOf('application/json') !== -1 ? await response.json() : null;
        setError((errorData && errorData.detail) || `Failed to fetch assignment history (${response.status})`);
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred while fetching assignment history');
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetail = async (sessionId, assignment) => {
    try {
      setSelectedAssignment(assignment);
      const token = localStorage.getItem('token');
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
        const errorData = contentType && contentType.indexOf('application/json') !== -1 ? await response.json() : null;
        alert(`Failed to fetch case details: ${(errorData && errorData.detail) || response.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while fetching case details');
    }
  };

  const filtered = assignments.filter(a => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (a.qc_subject_id || '').toLowerCase().includes(term)
      || (a.hospital_name || '').toLowerCase().includes(term)
      || (a.radiologist_name || '').toLowerCase().includes(term)
      || (a.radiologist_email || '').toLowerCase().includes(term);
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div style={contentStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,marginTop: -34, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ color: '#333', margin: 0 }}>Assign Radiologist History</h2>
        <input
          type="text"
          placeholder="Search by QC ID, Hospital, or Radiologist..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          style={{ width: 280, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #c8e0e2', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && assignments.length === 0 && (
        <p style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No assignments yet.</p>
      )}

      {!loading && !error && assignments.length > 0 && filtered.length === 0 && (
        <p style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No assignments match "{searchTerm}".</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
            Showing {paginated.length} of {filtered.length} assignments {searchTerm && `(filtered from ${assignments.length})`}
          </div>
          <div style={tableContainerStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={headerRowStyle}>
                  {['QC ID', 'Radiologist Name', 'Total Case/Study', 'Assessment', 'Status', 'Reason', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((a) => (
                  <tr key={a.assignment_id} style={rowStyle}>
                    <td style={tdStyle}>{a.qc_subject_id}</td>
                    <td style={tdStyle}>{a.radiologist_name || '-'}</td>
                    <td style={tdStyle}>{a.assessment_id}</td>
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
                        <button style={linkButtonStyle} onClick={() => fetchSessionDetail(a.session_id, a)}>View Case</button>
                      ) : (
                        <span style={{ color: '#aaa' }}>-</span>
                      )}
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

      {reasonModal && (
        <div style={modalOverlayStyle} onClick={() => setReasonModal(null)}>
          <div style={reasonDialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Reason — QC ID: {reasonModal.qc_subject_id}</h3>
            <p style={{ color: '#495057', whiteSpace: 'pre-wrap' }}>{reasonModal.review_notes}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={primaryDialogBtnStyle} onClick={() => setReasonModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && selectedSession && (
        <div style={modalOverlayStyle} onClick={() => setIsModalOpen(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3>Case for QC ID: {selectedAssignment?.qc_subject_id}</h3>
              <button style={closeButtonStyle} onClick={() => setIsModalOpen(false)}>&times;</button>
            </div>
            <div style={modalBodyStyle}>
              <DoctorAssessmentForm
                sessionId={selectedSession.qc_id}
                initialData={selectedSession.assessment}
                onSaveSuccess={() => {
                  fetchAssignments();
                  setTimeout(() => setIsModalOpen(false), 2000);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
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
  textAlign: 'left',
  color: '#495057',
  fontWeight: '600'
};

const rowStyle = {
  borderBottom: '1px solid #dee2e6'
};

const tdStyle = {
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'left',
};

const statusCellStyle = (status) => ({
  padding: '12px',
  verticalAlign: 'middle',
  textAlign: 'left',
  color: status === 'Completed' ? 'green' : '#b0691c',
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

const reasonDialogStyle = {
  backgroundColor: '#fff',
  width: '90%',
  maxWidth: 480,
  borderRadius: 10,
  padding: 24,
  boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
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

export default AssignRadiologistHistory;
