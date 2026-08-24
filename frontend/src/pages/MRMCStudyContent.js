import React, { useState, useEffect, useRef } from 'react';
import MRMCTableDetails from '../components/MRMCTableDetails';

const newBadgeStyle = {
  fontSize: '11px',
  fontWeight: 'bold',
  color: '#14868C',
  backgroundColor: '#DCF3EF',
  padding: '2px 8px',
  borderRadius: '10px',
  letterSpacing: '0.3px'
};

const kappaBadgeStyle = (score, threshold) => {
  let bg = '#F1F3F5', color = '#495057';
  if (score !== null && score !== undefined) {
    if (score >= threshold) { bg = '#E3F5E9'; color = '#1E7E4B'; }
    else { bg = '#FBE3E1'; color = '#C4302B'; }
  }
  return {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    backgroundColor: bg,
    color
  };
};

const dropdownFieldStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid #cfd8dc',
  backgroundColor: 'white',
  fontSize: '14px',
  marginBottom: '14px',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  userSelect: 'none',
  position: 'relative'
};

const dropdownPanelStyle = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  backgroundColor: 'white',
  border: '1px solid #cfd8dc',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  zIndex: 10,
  maxHeight: '220px',
  overflowY: 'auto'
};

const dropdownOptionStyle = {
  padding: '10px 12px',
  fontSize: '14px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
};

const clearOptionStyle = {
  padding: '10px 12px',
  fontSize: '13px',
  cursor: 'pointer',
  color: '#C4302B',
  fontWeight: 600,
  borderBottom: '1px solid #eee'
};

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  fontWeight: 600,
  color: '#14868C',
  backgroundColor: '#DCF3EF',
  padding: '3px 8px 3px 10px',
  borderRadius: '12px'
};

const chipRemoveStyle = {
  cursor: 'pointer',
  fontSize: '13px',
  lineHeight: 1,
  color: '#14868C'
};

const missingCellStyle = {
  color: '#C4302B',
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px'
};

// Generic multi-select dropdown used for Institutions, Subject IDs, and Readers.
// options/selected work with generic objects, compared by id via getId.
const MultiSelectDropdown = ({
  options,
  selected,
  onChange,
  placeholder,
  getLabel = (o) => o.full_name || o.name || o.subject_id,
  getId = (o) => o.id,
  helperText
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSelected = (id) => selected.some((u) => getId(u) === id);

  const toggleOption = (opt) => {
    if (isSelected(getId(opt))) {
      onChange(selected.filter((u) => getId(u) !== getId(opt)));
    } else {
      onChange([...selected, opt]);
    }
  };

  const removeChip = (id) => onChange(selected.filter((u) => getId(u) !== id));

  return (
    <div style={{ marginBottom: '4px' }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <div
          style={{ ...dropdownFieldStyle, marginBottom: 0, flexWrap: 'wrap', minHeight: '42px', paddingTop: '8px', paddingBottom: '8px' }}
          onClick={() => setOpen(!open)}
        >
          {selected.length === 0 ? (
            <span style={{ color: '#8a97a0' }}>{placeholder}</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
              {selected.map((s) => (
                <span key={getId(s)} style={chipStyle}>
                  {getLabel(s)}
                  <span
                    style={chipRemoveStyle}
                    onClick={(e) => { e.stopPropagation(); removeChip(getId(s)); }}
                  >
                    ×
                  </span>
                </span>
              ))}
            </div>
          )}
          <span style={{ fontSize: '11px', color: '#666' }}>▾</span>
        </div>
        {open && (
          <div style={dropdownPanelStyle}>
            {selected.length > 0 && (
              <div style={clearOptionStyle} onClick={() => { onChange([]); setOpen(false); }}>
                Clear selection
              </div>
            )}
            {options.map((opt) => (
              <label key={getId(opt)} style={dropdownOptionStyle}>
                <input
                  type="checkbox"
                  checked={isSelected(getId(opt))}
                  onChange={() => toggleOption(opt)}
                />
                {getLabel(opt)}
              </label>
            ))}
            {options.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: '13px', color: '#999' }}>
                No options available
              </div>
            )}
          </div>
        )}
      </div>
      {helperText && (
        <p style={{ fontSize: '12px', color: '#8a97a0', margin: '4px 0 14px' }}>{helperText}</p>
      )}
    </div>
  );
};

const ArbiterSelect = ({ options, selected, onChange, helperText }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ marginBottom: '4px' }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <div style={{ ...dropdownFieldStyle, marginBottom: 0 }} onClick={() => setOpen(!open)}>
          <span style={{ color: selected ? '#1a1a1a' : '#8a97a0' }}>
            {selected ? selected.full_name : 'Assign arbiter * (Eligibale 10-15 yrs, 15+ yrs exp)'}
          </span>
          <span style={{ fontSize: '11px', color: '#666' }}>▾</span>
        </div>
        {open && (
          <div style={dropdownPanelStyle}>
            {selected && (
              <div style={clearOptionStyle} onClick={() => { onChange(null); setOpen(false); }}>
                Clear selection
              </div>
            )}
            {options.map((user) => (
              <div
                key={user.id}
                style={dropdownOptionStyle}
                onClick={() => { onChange(user); setOpen(false); }}
              >
                {user.full_name}
              </div>
            ))}
            {options.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: '13px', color: '#999' }}>
                No clinicians available
              </div>
            )}
          </div>
        )}
      </div>
      {helperText && (
        <p style={{ fontSize: '12px', color: '#8a97a0', margin: '4px 0 14px' }}>{helperText}</p>
      )}
    </div>
  );
};

const AgreementInfoPopover = ({ title, body }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const iconStyle = { cursor: 'pointer', color: '#14868C', marginLeft: '4px' };

  const popoverStyle = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    width: '300px',
    backgroundColor: '#EAF2FB',
    border: '1px solid #CFE0F5',
    borderRadius: '8px',
    padding: '14px 16px',
    boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
    zIndex: 20,
    fontWeight: 'normal',
    textAlign: 'left'
  };

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span style={iconStyle} onClick={() => setOpen(!open)}>ⓘ</span>
      {open && (
        <div style={popoverStyle}>
          <p style={{ fontWeight: 'bold', color: '#1d4e89', marginBottom: '6px' }}>{title}</p>
          <p style={{ color: '#333', fontSize: '13px', margin: 0 }}>{body}</p>
        </div>
      )}
    </span>
  );
};

// Table of subjects with auto-populated stratification data, shown once
// subject IDs are selected. Fields missing on a subject's record are
// flagged in red rather than left blank, per the current requirement.
const StratificationTable = ({ rows, includedIds, onToggleInclude }) => {
  if (!rows || rows.length === 0) return null;

  const Cell = ({ value }) =>
    value ? (
      <td style={{ padding: '8px 10px', fontSize: '13px' }}>{value}</td>
    ) : (
      <td style={{ padding: '8px 10px' }}>
        <span style={missingCellStyle}>✕ Missing</span>
      </td>
    );

  const missingCount = rows.filter(
    (r) => !r.ethnicity || !r.age_band || !r.state || !r.machine_type || !r.machine_brand
  ).length;

  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#1a1a1a', margin: '1 0 4px' }}>
        Case stratification
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: '6px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e0e0e0', backgroundColor: '#DCF3EF' }}>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>Subject ID</th>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>Ethnicity</th>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>Age band</th>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>State</th>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>Machine</th>
              <th style={{ padding: '8px 10px', fontSize: '13px', color: '#333' }}>Institution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subject_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 10px', fontSize: '13px', fontWeight: 600 }}>{r.subject_id}</td>
                <Cell value={r.ethnicity} />
                <Cell value={r.age_band} />
                <Cell value={r.state} />
                <Cell value={r.machine_type} />
                <td style={{ padding: '8px 10px', fontSize: '13px' }}>{r.institution_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingCount > 0 && (
        <p style={{ fontSize: '12px', color: '#C4302B', margin: '8px 0 0' }}>
          ⚠ {missingCount} subject{missingCount > 1 ? 's have' : ' has'} missing fields. Included subjects
          can still proceed — confirm whether that should be blocked instead.
        </p>
      )}
    </div>
  );
};

const MRMCStudyContent = () => {
  const [expanded, setExpanded] = useState(true);

  const [selectedReaders, setSelectedReaders] = useState([]);
  const [selectedArbiter, setSelectedArbiter] = useState(null);

  const [clinicians, setClinicians] = useState([]);
  const [cliniciansLoading, setCliniciansLoading] = useState(true);

  // --- Institutions -> Subjects (both multi-select) -> stratification table ---
  const [institutions, setInstitutions] = useState([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(true);
  const [selectedInstitutions, setSelectedInstitutions] = useState([]);

  const [subjects, setSubjects] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [selectedSubjects, setSelectedSubjects] = useState([]);

  const [stratificationRows, setStratificationRows] = useState([]);
  const [stratificationLoading, setStratificationLoading] = useState(false);
  const [includedSubjectIds, setIncludedSubjectIds] = useState(new Set());
  // -----------------------------------------------------------------------------

  const [creating, setCreating] = useState(false);
  const [activeStudy, setActiveStudy] = useState(null); // { id, name }
  const [participants, setParticipants] = useState([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const readerOptions = clinicians.filter(
    (u) => u.id !== selectedArbiter?.id
  );

  const arbiterOptions = clinicians.filter(
    (u) => !selectedReaders.some((r) => r.id === u.id)
  );

  useEffect(() => {
    fetchParticipants();
    fetchInstitutions();
  }, []);

  // Institutions changed -> clear subjects & stratification, reload subject list
  useEffect(() => {
    setSelectedSubjects([]);
    setStratificationRows([]);
    setIncludedSubjectIds(new Set());
    setSubjects([]);

    // Clear previously selected readers/arbiter
    setSelectedReaders([]);
    setSelectedArbiter(null);

    if (selectedInstitutions.length > 0) {
      const institutionIds = selectedInstitutions.map((i) => i.id);

      // Fetch subjects for selected institutions
      fetchSubjects(institutionIds);

      // Fetch clinicians for selected institutions
      fetchClinicians(institutionIds);
    } else {
      setClinicians([]);
    }
  }, [selectedInstitutions]);

  // Subjects changed -> reload stratification data for the current selection
  useEffect(() => {
    if (selectedSubjects.length > 0) {
      fetchStratification(selectedSubjects.map((s) => s.id));
    } else {
      setStratificationRows([]);
      setIncludedSubjectIds(new Set());
    }
  }, [selectedSubjects]);

  const fetchClinicians = async (institutionIds) => {
    if (!institutionIds || institutionIds.length === 0) {
      setClinicians([]);
      setSelectedReaders([]);
      setSelectedArbiter(null);
      return;
    }

    setCliniciansLoading(true);

    try {
      const token = localStorage.getItem('token');

      const params = institutionIds
        .map((id) => `institution_id=${encodeURIComponent(id)}`)
        .join('&');

      const response = await fetch(
        `${process.env.REACT_APP_API_URL || ''}/api/v1/admin/users/clinicians?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const contentType = response.headers.get('content-type');

      if (
        response.ok &&
        contentType &&
        contentType.indexOf('application/json') !== -1
      ) {
        const data = await response.json();

        if (Array.isArray(data)) {
          setClinicians(data);
        } else {
          console.error('Clinicians data is not an array:', data);
          setClinicians([]);
        }
      } else {
        const text = await response.text();
        console.error('Failed to fetch clinicians:', text);
        setClinicians([]);
        alert(`Error: Failed to fetch clinicians list. Status: ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch clinicians', err);
      setClinicians([]);
      alert('Error: Network error while fetching clinicians.');
    } finally {
      setCliniciansLoading(false);
    }
  };
  const fetchParticipants = async () => {
    setParticipantsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || ''}/api/v1/admin/mrmc-studies/participants`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const contentType = response.headers.get('content-type');
      if (response.ok && contentType && contentType.indexOf('application/json') !== -1) {
        const data = await response.json();
        setParticipants(Array.isArray(data) ? data : []);
      } else {
        const text = await response.text();
        console.error('Failed to fetch participants:', text);
        alert(`Error: Failed to fetch reader panel. Status: ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch participants', err);
      alert('Error: Network error while fetching reader panel.');
    } finally {
      setParticipantsLoading(false);
    }
  };

  const fetchInstitutions = async () => {
    setInstitutionsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || ''}/api/v1/auth/hospitals`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const contentType = response.headers.get('content-type');
      if (response.ok && contentType && contentType.indexOf('application/json') !== -1) {
        const data = await response.json();
        setInstitutions(Array.isArray(data) ? data : []);
      } else {
        const text = await response.text();
        console.error('Failed to fetch institutions:', text);
        alert(`Error: Failed to fetch institutions. Status: ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch institutions', err);
      alert('Error: Network error while fetching institutions.');
    } finally {
      setInstitutionsLoading(false);
    }
  };

  // NOTE: expects the backend to accept multiple institution IDs. Confirm the
  // actual query-param / route shape against your API before wiring this up.
  const fetchSubjects = async (institutionIds) => {
    setSubjectsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = institutionIds.map((id) => `institution_id=${id}`).join('&');
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || ''}/api/v1/admin/subjects?${params}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const contentType = response.headers.get('content-type');
      if (response.ok && contentType && contentType.indexOf('application/json') !== -1) {
        const data = await response.json();
        setSubjects(Array.isArray(data) ? data : []);
      } else {
        const text = await response.text();
        console.error('Failed to fetch subjects:', text);
        alert(`Error: Failed to fetch subjects. Status: ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch subjects', err);
      alert('Error: Network error while fetching subjects.');
    } finally {
      setSubjectsLoading(false);
    }
  };

  // Calls POST /api/v1/admin/subjects/case-data with the selected subject IDs.
  // Backend returns { patient_session_id, ethnicity, age, state, machine, brand,
  // institution } per subject (null for anything missing) — mapped here to the
  // field names StratificationTable expects.
  const fetchStratification = async (subjectIds) => {
    setStratificationLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || ''}/api/v1/admin/subjects/case-data`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(subjectIds)
        }
      );
      const contentType = response.headers.get('content-type');
      if (response.ok && contentType && contentType.indexOf('application/json') !== -1) {
        const data = await response.json();
        const rows = (Array.isArray(data) ? data : []).map((d) => ({
          subject_id: d.patient_id,
          ethnicity: d.ethnicity,
          age_band: d.age,
          state: d.state,
          machine_type: d.machine,
          machine_brand: d.brand,
          institution_name: d.institution
        }));
        setStratificationRows(rows);
        setIncludedSubjectIds(new Set(rows.map((r) => r.subject_id)));
      } else {
        const text = await response.text();
        console.error('Failed to fetch stratification data:', text);
        alert(`Error: Failed to fetch case stratification data. Status: ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch stratification data', err);
      alert('Error: Network error while fetching case stratification data.');
    } finally {
      setStratificationLoading(false);
    }
  };

  const toggleIncludeSubject = (subjectId) => {
    setIncludedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  };

  const handleCreateStudy = async () => {
    if (selectedInstitutions.length === 0) {
      alert('Error: At least one institution must be selected.');
      return;
    }
    if (includedSubjectIds.size === 0) {
      alert('Error: At least one subject must be included.');
      return;
    }
    if (selectedReaders.length < 2) {
      alert('Error: At least 2 readers must be assigned.');
      return;
    }
    if (!selectedArbiter) {
      alert('Error: An arbiter must be assigned.');
      return;
    }

    setCreating(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/v1/admin/mrmc-studies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: `MRMC Study - ${new Date().toLocaleString()}`,
          institution_ids: selectedInstitutions.map((i) => i.id),
          subject_ids: Array.from(includedSubjectIds),
          reader_user_ids: selectedReaders.map((u) => u.id),
          arbiter_user_id: selectedArbiter.id
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert('MRMC study created successfully!');
        setActiveStudy({ id: data.id, name: data.name });
        setSelectedReaders([]);
        setSelectedArbiter(null);
        setSelectedInstitutions([]);
        setSelectedSubjects([]);
        setStratificationRows([]);
        setIncludedSubjectIds(new Set());
        fetchParticipants();
      } else {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
          const error = await response.json();
          const detail = error.detail;
          const message = Array.isArray(detail)
            ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
            : (detail || 'Failed to create study');
          alert(`Error: ${message}`);
        } else {
          const errorText = await response.text();
          console.error('Non-JSON error response:', errorText);
          alert(`Error: Received non-JSON response from server. Status: ${response.status}`);
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const cardStyle = {
    border: '1px solid #B7E0D8',
    borderRadius: '8px',
    backgroundColor: '#F3FAF8',
    marginBottom: '30px'
  };

  const cardHeaderStyle = {
    padding: '18px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    justifyContent: 'space-between',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '17px',
    color: '#1a1a1a',
    borderRadius: '8px 8px 0 0'
  };

  const fieldWrapStyle = { padding: '0 20px 20px' };

  const inputFieldStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #cfd8dc',
    backgroundColor: 'white',
    fontSize: '14px',
    marginBottom: '14px',
    boxSizing: 'border-box'
  };

  return (
    <div>
      <div style={cardStyle}>
        <div style={cardHeaderStyle} onClick={() => setExpanded(!expanded)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            Create MRMC study
          </span>
          <span>{expanded ? '−' : '+'}</span>
        </div>
        {expanded && (
          <div style={fieldWrapStyle}>
            {institutionsLoading ? (
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '14px' }}>Loading institutions...</p>
            ) : (
              <MultiSelectDropdown
                options={institutions}
                selected={selectedInstitutions}
                onChange={setSelectedInstitutions}
                placeholder="Select institutions *"
                getLabel={(o) => o.name}
              />
            )}

            <MultiSelectDropdown
              options={subjects}
              selected={selectedSubjects}
              onChange={setSelectedSubjects}
              placeholder={
                selectedInstitutions.length === 0
                  ? 'Select Subjects ID *'
                  : subjectsLoading
                    ? 'Loading subjects...'
                    : 'Select subject IDs *'
              }
              getLabel={(o) => o.subject_id}
            />

            {stratificationLoading ? (
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '14px' }}>Loading case data...</p>
            ) : (
              <StratificationTable
                rows={stratificationRows}
                includedIds={includedSubjectIds}
                onToggleInclude={toggleIncludeSubject}
              />
            )}

            <MultiSelectDropdown
              options={readerOptions}
              selected={selectedReaders}
              onChange={setSelectedReaders}
              placeholder="Assign readers * (Eligibale 0-5 yrs, 6-10 yrs exp)"
            />

            <ArbiterSelect
              options={arbiterOptions}
              selected={selectedArbiter}
              onChange={setSelectedArbiter}
            />
            <button
              style={{
                padding: '10px 20px',
                backgroundColor: '#14868C',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                opacity: creating ? 0.7 : 1
              }}
              disabled={creating || cliniciansLoading}
              onClick={handleCreateStudy}
            >
              {creating ? 'Creating...' : 'Create New Study'}
            </button>
          </div>
        )}
      </div>

      <MRMCTableDetails />
    </div>
  );
};

export default MRMCStudyContent;