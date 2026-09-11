import React, { useEffect, useState } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '';

const RISK_COLORS = { Baseline: '#6ee7b7', Evident: '#fde047', Significant: '#fb923c', High: '#fb7185' };
const RISK_ORDER = ['Baseline', 'Evident', 'Significant', 'High'];

const authHeaders = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}` });

// Shared by both the create form and the assign modal so the two paths
// always pick cases the same way.
const pickRandomSubjects = (pool, count) =>
  [...pool].sort(() => Math.random() - 0.5).slice(0, count).map((s) => s.qc_subject_id);

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    throw new Error((body && body.detail) || `Request failed (${res.status})`);
  }
  return res.json();
}

async function apiPost(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((body && body.detail) || `Request failed (${res.status})`);
  }
  return body;
}

const CheckboxDropdown = ({ label, options, getId, getLabel, selected, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{ ...ddButtonStyle, opacity: disabled ? 0.6 : 1 }}
      >
        {selected.size > 0 ? `${selected.size} selected` : label}
        <span style={{ marginLeft: 8 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={ddPanelStyle}>
          {options.length === 0 && <div style={{ padding: 10, fontSize: 13, color: '#888' }}>No options available</div>}
          {options.map((o) => {
            const id = getId(o);
            return (
              <label key={id} style={ddOptionStyle}>
                <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} style={{ marginRight: 8 }} />
                {getLabel(o)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

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

const StatusBadge = ({ status }) => (
  <span style={{
    display: 'inline-block', padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
    backgroundColor: status === 'Completed' ? '#e3f5e9' : '#fdf0da',
    color: status === 'Completed' ? '#1e7e4b' : '#b0691c',
  }}>{status}</span>
);

const QCAdminDashboard = () => {
  const [subjects, setSubjects] = useState([]);
  const [radiologists, setRadiologists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null); // null | 'radiologist' | 'mammotech'
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mammoSubjects, setMammoSubjects] = useState([]);
  const [createMTForm, setCreateMTForm] = useState({ fullName: '', email: '', password: '' });
  const [createMTSelectedSubjects, setCreateMTSelectedSubjects] = useState(new Set());
  const [createMTAssignMode, setCreateMTAssignMode] = useState('random');
  const [createMTRandomCount, setCreateMTRandomCount] = useState('');
  const [creatingMT, setCreatingMT] = useState(false);
  const [showMTPassword, setShowMTPassword] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignRadiologistId, setAssignRadiologistId] = useState('');
  const [assignSelectedSubjects, setAssignSelectedSubjects] = useState(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignMode, setAssignMode] = useState('manual');
  const [randomCount, setRandomCount] = useState('');
  const [mammoTechs, setMammoTechs] = useState([]);
  const [assignMTModalOpen, setAssignMTModalOpen] = useState(false);
  const [assignMammoTechId, setAssignMammoTechId] = useState('');
  const [assignMTSelectedSubjects, setAssignMTSelectedSubjects] = useState(new Set());
  const [assigningMT, setAssigningMT] = useState(false);
  const [assignMTMode, setAssignMTMode] = useState('manual');
  const [mtRandomCount, setMTRandomCount] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subjectsData, radiologistsData, mammoSubjectsData, mammoTechsData] = await Promise.all([
        apiGet('/api/v1/qc/admin/subjects'),
        apiGet('/api/v1/qc/admin/radiologists'),
        apiGet('/api/v1/qc/admin/subjects?for_role=mammo_tech'),
        apiGet('/api/v1/qc/admin/mammo-techs'),
      ]);
      setSubjects(subjectsData);
      setRadiologists(radiologistsData);
      setMammoSubjects(mammoSubjectsData);
      setMammoTechs(mammoTechsData);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const toggleSection = (section) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const unassignedSubjects = subjects.filter(s => s.assignment_status === 'Unassigned');
  const mammoUnassignedSubjects = mammoSubjects.filter(s => s.assignment_status === 'Unassigned');

  const riskCounts = subjects.reduce((acc, s) => {
    const label = riskLabel(s.risk_category);
    if (label) acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const handleCreateRadiologist = async () => {
    if (!createForm.fullName || !createForm.email || !createForm.password) {
      alert('Full Name, Email and Password are required.');
      return;
    }

    setCreating(true);
    try {
      await apiPost('/api/v1/qc/admin/users', {
        full_name: createForm.fullName,
        email: createForm.email,
        password: createForm.password,
        role: 'Radiologist',
      });
      alert('Radiologist created successfully.');
      setCreateForm({ fullName: '', email: '', password: '' });
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateMammoTech = async () => {
    if (!createMTForm.fullName || !createMTForm.email || !createMTForm.password) {
      alert('Full Name, Email and Password are required.');
      return;
    }
    let caseIds;
    if (createMTAssignMode === 'random') {
      const count = Number(createMTRandomCount);
      if (!count || count <= 0) {
        alert('Enter a valid number of cases to randomly assign.');
        return;
      }
      if (count > mammoUnassignedSubjects.length) {
        alert(`Only ${mammoUnassignedSubjects.length} unassigned subject(s) available.`);
        return;
      }
      caseIds = pickRandomSubjects(mammoUnassignedSubjects, count);
    } else {
      caseIds = Array.from(createMTSelectedSubjects);
    }

    setCreatingMT(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/users', {
        full_name: createMTForm.fullName,
        email: createMTForm.email,
        password: createMTForm.password,
        role: 'Mammo Tech',
        cases: caseIds,
      });
      const failedNote = result.failed_cases && result.failed_cases.length
        ? ` (${result.failed_cases.length} subject(s) could not be matched: ${result.failed_cases.join(', ')})`
        : '';
      alert(`Mammo Tech created and ${result.assigned_cases} case(s) assigned.${failedNote}`);
      setCreateMTForm({ fullName: '', email: '', password: '' });
      setCreateMTSelectedSubjects(new Set());
      setCreateMTRandomCount('');
      setCreateMTAssignMode('random');
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreatingMT(false);
    }
  };

  const closeAssignModal = () => {
    setAssignModalOpen(false);
    setAssignRadiologistId('');
    setAssignSelectedSubjects(new Set());
    setAssignMode('manual');
    setRandomCount('');
  };

  const handleAssignRadiologist = async () => {
    if (!assignRadiologistId) {
      alert('Select a radiologist.');
      return;
    }

    let subjectIds;
    if (assignMode === 'random') {
      const count = Number(randomCount);
      if (!count || count <= 0) {
        alert('Enter a valid number of cases to randomly assign.');
        return;
      }
      if (count > unassignedSubjects.length) {
        alert(`Only ${unassignedSubjects.length} unassigned subject(s) available.`);
        return;
      }
      subjectIds = pickRandomSubjects(unassignedSubjects, count);
    } else {
      if (assignSelectedSubjects.size === 0) {
        alert('Select a radiologist and at least one subject.');
        return;
      }
      subjectIds = Array.from(assignSelectedSubjects);
    }

    setAssigning(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/assign-radiologist', {
        radiologist_id: Number(assignRadiologistId),
        subject_ids: subjectIds,
      });
      alert(`Assigned ${result.assigned_count} subject(s)${result.reassigned_count ? ` (${result.reassigned_count} reassigned)` : ''}.` +
        (result.blocked_completed_subject_ids.length ? ` ${result.blocked_completed_subject_ids.length} already-completed case(s) were skipped.` : ''));
      closeAssignModal();
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setAssigning(false);
    }
  };

  const closeAssignMTModal = () => {
    setAssignMTModalOpen(false);
    setAssignMammoTechId('');
    setAssignMTSelectedSubjects(new Set());
    setAssignMTMode('manual');
    setMTRandomCount('');
  };

  const handleAssignMammoTech = async () => {
    if (!assignMammoTechId) {
      alert('Select a Mammo Tech.');
      return;
    }

    let subjectIds;
    if (assignMTMode === 'random') {
      const count = Number(mtRandomCount);
      if (!count || count <= 0) {
        alert('Enter a valid number of cases to randomly assign.');
        return;
      }
      if (count > mammoUnassignedSubjects.length) {
        alert(`Only ${mammoUnassignedSubjects.length} unassigned subject(s) available.`);
        return;
      }
      subjectIds = pickRandomSubjects(mammoUnassignedSubjects, count);
    } else {
      if (assignMTSelectedSubjects.size === 0) {
        alert('Select a Mammo Tech and at least one subject.');
        return;
      }
      subjectIds = Array.from(assignMTSelectedSubjects);
    }

    setAssigningMT(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/assign-mammo-tech', {
        mammo_tech_id: Number(assignMammoTechId),
        subject_ids: subjectIds,
      });
      alert(`Assigned ${result.assigned_count} subject(s)${result.reassigned_count ? ` (${result.reassigned_count} reassigned)` : ''}.` +
        (result.blocked_completed_subject_ids.length ? ` ${result.blocked_completed_subject_ids.length} already-completed case(s) were skipped.` : ''));
      closeAssignMTModal();
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setAssigningMT(false);
    }
  };

  if (loading) return <p style={{ padding: 20 }}>Loading QC dashboard...</p>;
  if (error) return <p style={{ padding: 20, color: 'red' }}>{error}</p>;

  return (
    <div style={dashboardRowStyle}>
      {/* Create Radiologist / Create Mammo Tech accordions */}
      <div style={formColumnStyle}>
        <div style={{ ...cardStyle, textAlign: 'left' }}>
          {/* <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button type="button" onClick={() => setAssignModalOpen(true)} style={secondaryButtonStyle}>
              Assign Radiologist
            </button>
          </div> */}

          {/* Create Radiologist — independent of case assignment; no Radiologist
              is created as a side effect of creating a Mammo Tech, or vice versa. */}
          <div style={accordionStyle}>
            <div style={accordionHeaderStyle} onClick={() => toggleSection('radiologist')}>
              Create Radiologist
              <span>{expandedSection === 'radiologist' ? '−' : '+'}</span>
            </div>
            {expandedSection === 'radiologist' && (
              <div style={accordionContentStyle}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                  <button type="button" onClick={() => setAssignModalOpen(true)} style={secondaryButtonStyle}>
                    Assign Radiologist
                  </button>
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>Full Name</label>
                  <input
                    style={inputStyle}
                    name="qc-new-radiologist-name"
                    autoComplete="off"
                    spellCheck={false}
                    value={createForm.fullName}
                    onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>User Email</label>
                  {/* type="text" + inputMode keeps the email keyboard on mobile without
                      triggering the browser's saved-email autofill on this field. */}
                  <input
                    style={inputStyle}
                    type="text"
                    inputMode="email"
                    name="qc-new-radiologist-email"
                    autoComplete="off"
                    spellCheck={false}
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Password</label>
                  <div style={{ position: 'relative' }}>
                    {/* autoComplete="new-password" tells the browser this is a password
                        being set, not the signed-in admin's own saved password. */}
                    <input
                      style={{ ...inputStyle, paddingRight: 34 }}
                      type={showPassword ? 'text' : 'password'}
                      name="qc-new-radiologist-password"
                      autoComplete="new-password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
                    <span onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}>
                      {showPassword ? '🙈' : '👁️'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" disabled={creating} onClick={handleCreateRadiologist}
                    style={{ ...primaryButtonStyle, opacity: creating ? 0.7 : 1 }}>
                    {creating ? 'Creating...' : 'Create Radiologist'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Create Mammo Tech — a separate user-creation workflow with the same
              random/manual case-assignment UX as Radiologist assignment reuses. */}
          <div style={{ ...accordionStyle, marginBottom: 0 }}>
            <div style={accordionHeaderStyle} onClick={() => toggleSection('mammotech')}>
              Create Mammo Tech
              <span>{expandedSection === 'mammotech' ? '−' : '+'}</span>
            </div>
            {expandedSection === 'mammotech' && (
              <div style={accordionContentStyle}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                  <button type="button" onClick={() => setAssignMTModalOpen(true)} style={secondaryButtonStyle}>
                    Assign Mammo Tech
                  </button>
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>Full Name</label>
                  <input
                    style={inputStyle}
                    name="qc-new-mammotech-name"
                    autoComplete="off"
                    spellCheck={false}
                    value={createMTForm.fullName}
                    onChange={(e) => setCreateMTForm({ ...createMTForm, fullName: e.target.value })} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>User Email</label>
                  <input
                    style={inputStyle}
                    type="text"
                    inputMode="email"
                    name="qc-new-mammotech-email"
                    autoComplete="off"
                    spellCheck={false}
                    value={createMTForm.email}
                    onChange={(e) => setCreateMTForm({ ...createMTForm, email: e.target.value })} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      style={{ ...inputStyle, paddingRight: 34 }}
                      type={showMTPassword ? 'text' : 'password'}
                      name="qc-new-mammotech-password"
                      autoComplete="new-password"
                      value={createMTForm.password}
                      onChange={(e) => setCreateMTForm({ ...createMTForm, password: e.target.value })} />
                    <span onClick={() => setShowMTPassword(!showMTPassword)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}>
                      {showMTPassword ? '🙈' : '👁️'}
                    </span>
                  </div>
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>Assignment Mode</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setCreateMTAssignMode('random')}
                      style={modeButtonStyle(createMTAssignMode === 'random')}>
                      Random Assign
                    </button>
                    <button type="button" onClick={() => setCreateMTAssignMode('manual')}
                      style={modeButtonStyle(createMTAssignMode === 'manual')}>
                      Select Manually
                    </button>
                  </div>
                </div>

                {createMTAssignMode === 'manual' ? (
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Select Cases / Subjects</label>
                    <CheckboxDropdown
                      label="Select Subjects"
                      options={mammoUnassignedSubjects}
                      getId={(s) => s.qc_subject_id}
                      getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'}`}
                      selected={createMTSelectedSubjects}
                      onChange={setCreateMTSelectedSubjects}
                    />
                  </div>
                ) : (
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Number of Cases</label>
                    <input
                      style={inputStyle}
                      type="number"
                      min="1"
                      max={mammoUnassignedSubjects.length}
                      placeholder="e.g. 50"
                      value={createMTRandomCount}
                      onChange={(e) => setCreateMTRandomCount(e.target.value)}
                    />
                    {/* <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                      {mammoUnassignedSubjects.length} unassigned subject(s) available. A random, non-overlapping set will be assigned to the new Mammo Tech.
                    </div> */}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    Total Subjects: {mammoSubjects.length} · Unassigned: {mammoUnassignedSubjects.length}
                  </div>
                  <button type="button" disabled={creatingMT} onClick={handleCreateMammoTech}
                    style={{ ...primaryButtonStyle, opacity: creatingMT ? 0.7 : 1 }}>
                    {creatingMT ? 'Creating...' : 'Create Mammo Tech'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {assignModalOpen && (
        <div style={modalOverlayStyle} onClick={closeAssignModal}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Assign Radiologist</h3>
            <div style={fieldStyle}>
              <label style={labelStyle}>Radiologist</label>
              <select style={inputStyle} value={assignRadiologistId} onChange={(e) => setAssignRadiologistId(e.target.value)}>
                <option value="">Select Radiologist</option>
                {radiologists.map((r) => (
                  <option key={r.id} value={r.id}>{r.full_name || r.email} ({r.email})</option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Assignment Mode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setAssignMode('random')}
                  style={modeButtonStyle(assignMode === 'random')}>
                  Random Assign
                </button>
                 <button type="button" onClick={() => setAssignMode('manual')}
                  style={modeButtonStyle(assignMode === 'manual')}>
                  Select Manually
                </button>
              </div>
            </div>

            {assignMode === 'manual' ? (
              <div style={fieldStyle}>
                <label style={labelStyle}>Subjects</label>
                <CheckboxDropdown
                  label="Select Subjects"
                  options={subjects}
                  getId={(s) => s.qc_subject_id}
                  getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'} (${s.assignment_status})`}
                  selected={assignSelectedSubjects}
                  onChange={setAssignSelectedSubjects}
                />
              </div>
            ) : (
              <div style={fieldStyle}>
                <label style={labelStyle}>Number of Cases</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  max={unassignedSubjects.length}
                  placeholder="e.g. 50"
                  value={randomCount}
                  onChange={(e) => setRandomCount(e.target.value)}
                />
                {/* <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                  {unassignedSubjects.length} unassigned subject(s) available. A random, non-overlapping set will be assigned.
                </div> */}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeAssignModal} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" disabled={assigning} onClick={handleAssignRadiologist}
                style={{ ...primaryButtonStyle, opacity: assigning ? 0.7 : 1 }}>
                {assigning ? 'Assigning...' : 'Assign Radiologist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignMTModalOpen && (
        <div style={modalOverlayStyle} onClick={closeAssignMTModal}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Assign Mammo Tech</h3>
            <div style={fieldStyle}>
              <label style={labelStyle}>Mammo Tech</label>
              <select style={inputStyle} value={assignMammoTechId} onChange={(e) => setAssignMammoTechId(e.target.value)}>
                <option value="">Select Mammo Tech</option>
                {mammoTechs.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name || m.email} ({m.email})</option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Assignment Mode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setAssignMTMode('random')}
                  style={modeButtonStyle(assignMTMode === 'random')}>
                  Random Assign
                </button>
                 <button type="button" onClick={() => setAssignMTMode('manual')}
                  style={modeButtonStyle(assignMTMode === 'manual')}>
                  Select Manually
                </button>
              </div>
            </div>

            {assignMTMode === 'manual' ? (
              <div style={fieldStyle}>
                <label style={labelStyle}>Subjects</label>
                <CheckboxDropdown
                  label="Select Subjects"
                  options={mammoSubjects}
                  getId={(s) => s.qc_subject_id}
                  getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'} (${s.assignment_status})`}
                  selected={assignMTSelectedSubjects}
                  onChange={setAssignMTSelectedSubjects}
                />
              </div>
            ) : (
              <div style={fieldStyle}>
                <label style={labelStyle}>Number of Cases</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  max={mammoUnassignedSubjects.length}
                  placeholder="e.g. 50"
                  value={mtRandomCount}
                  onChange={(e) => setMTRandomCount(e.target.value)}
                />
                {/* <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                  {mammoUnassignedSubjects.length} unassigned subject(s) available. A random, non-overlapping set will be assigned.
                </div> */}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeAssignMTModal} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" disabled={assigningMT} onClick={handleAssignMammoTech}
                style={{ ...primaryButtonStyle, opacity: assigningMT ? 0.7 : 1 }}>
                {assigningMT ? 'Assigning...' : 'Assign Mammo Tech'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const dashboardRowStyle = {
  display: 'flex',
  gap: 20,
  flexWrap: 'wrap',
  alignItems: 'stretch',
};

const formColumnStyle = { flex: '1 1 480px', minWidth: 320, maxWidth: '100%', display: 'flex' };

const cardStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e0e7eb',
  borderRadius: 12,
  padding: 18,
  textAlign: 'center',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
};

/* ---------- Form ---------- */

const accordionStyle = {
  marginBottom: 10,
  border: '1px solid #ddd',
  borderRadius: 4,
  overflow: 'hidden',
};

const accordionHeaderStyle = {
  padding: 15,
  backgroundColor: '#f8f9fa',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 'bold',
  color: '#333',
};

const accordionContentStyle = {
  padding: 20,
  borderTop: '1px solid #ddd',
  backgroundColor: 'white',
};

const fieldStyle = { marginBottom: 14 };
const labelStyle = { display: 'block', marginBottom: 5, fontWeight: 500, fontSize: 13 };
const inputStyle = { width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' };

const primaryButtonStyle = {
  padding: '10px 20px', backgroundColor: '#14868C', color: 'white', border: 'none',
  borderRadius: 4, cursor: 'pointer', fontWeight: 'bold',
};

const secondaryButtonStyle = {
  padding: '8px 16px', backgroundColor: '#fff', color: '#14868C', border: '1.5px solid #14868C',
  borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: 13, whiteSpace: 'nowrap',
};

const modeButtonStyle = (active) => ({
  flex: 1,
  padding: '9px 12px',
  fontSize: 13,
  fontWeight: 'bold',
  borderRadius: 4,
  cursor: 'pointer',
  backgroundColor: active ? '#14868C' : '#fff',
  color: active ? '#fff' : '#14868C',
  border: `1.5px solid ${active ? '#14868C' : '#cbd5d8'}`,
  transition: 'background-color 0.15s, border-color 0.15s',
});

const ddButtonStyle = {
  width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc',
  background: '#fff', cursor: 'pointer', fontSize: 13,
};

const ddPanelStyle = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff',
  border: '1px solid #ccc', borderRadius: 4, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
};

const ddOptionStyle = {
  display: 'flex', alignItems: 'center', padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f5f5f5',
};

const modalOverlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
};

const modalContentStyle = {
  backgroundColor: '#fff', width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
  borderRadius: 8, padding: 24, boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
};

export default QCAdminDashboard;