import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell } from 'recharts';

const API_BASE = process.env.REACT_APP_API_URL || '';

const authHeaders = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}` });

// Shared by both the create form and the assign modals so every path picks
// cases the same way.
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
  const [search, setSearch] = useState('');
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };
  const filtered = search.trim()
    ? options.filter((o) => getLabel(o).toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{ ...ddButtonStyle, opacity: disabled ? 0.6 : 1 }}
      >
        {selected.size > 0 ? `${selected.size} selected` : label}
        <span style={{ marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={ddPanelStyle}>
          <input
            type="text"
            autoFocus
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={ddSearchInputStyle}
          />
          {filtered.length === 0 && (
            <div style={{ padding: 10, fontSize: 13, color: '#888' }}>
              {options.length === 0 ? 'No options available' : 'No matches'}
            </div>
          )}
          {filtered.map((o) => {
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

// Single-select counterpart to CheckboxDropdown — used for "Select Radiologist" /
// "Select Mammo Tech" so both pickers look and behave identically, search included.
const SearchableSelect = ({ placeholder, options, getId, getLabel, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? options.filter((o) => getLabel(o).toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const selectedOption = options.find((o) => String(getId(o)) === String(value));
  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={ddButtonStyle}
      >
        {selectedOption ? getLabel(selectedOption) : placeholder}
        <span style={{ marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={ddPanelStyle}>
          <input
            type="text"
            autoFocus
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={ddSearchInputStyle}
          />
          {filtered.length === 0 && (
            <div style={{ padding: 10, fontSize: 13, color: '#888' }}>
              {options.length === 0 ? 'No options available' : 'No matches'}
            </div>
          )}
          {filtered.map((o) => {
            const id = getId(o);
            return (
              <div key={id} style={ddOptionStyle} onClick={() => pick(id)}>
                {getLabel(o)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const renderSliceLabel = (textColors) => ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
  if (!percent || percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * (innerRadius > 0 ? 0.5 : 0.62);
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill={textColors[name] || '#111'}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontSize: 13, fontWeight: 700 }}
    >
      {`${Math.round(percent * 100)}%`}
    </text>
  );
};

const DonutStat = ({ title, completed, total, pending, extraLabel, extraValue }) => {
  const data = total > 0
    ? [{ name: 'Completed', value: completed }, { name: 'Pending', value: total - completed }]
    : [{ name: 'Pending', value: 1 }];
  return (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>{title}</div>

      <div style={cardBodyStyle}>
        <div style={{ position: 'relative', width: 360, height: 260 }}>
          <PieChart width={360} height={260}>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={85}
              outerRadius={130}
              startAngle={130}
              endAngle={-270}
              labelLine={false}
              label={total > 0 ? renderSliceLabel({ Completed: '#ffffff', Pending: '#ffffff' }) : false}
              isAnimationActive={false}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.name === 'Completed' ? '#0d9488' : '#fb923c'} stroke="none" />
              ))}
            </Pie>
          </PieChart>
          <div style={donutCenterStyle}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{completed} / {total}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Completed</div>
          </div>
        </div>
      </div>

      <div style={cardFooterStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Pending</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fb923c' }}>{pending}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>{extraLabel}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#14868C' }}>{extraValue}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const QCAdminDashboard = () => {
  const [subjects, setSubjects] = useState([]);
  const [radiologists, setRadiologists] = useState([]);
  const [mammotechs, setMammotechs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create User (Radiologist or Mammo Tech)
  const [createRole, setCreateRole] = useState('Mammo Tech');
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', password: '' });
  const [createSelectedSubjects, setCreateSelectedSubjects] = useState(new Set());
  const [createAssignMode, setCreateAssignMode] = useState('random');
  const [createRandomCount, setCreateRandomCount] = useState('');
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Assign Radiologist (cases whose Mammo Tech review is Accepted)
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignRadiologistId, setAssignRadiologistId] = useState('');
  const [assignSelectedSubjects, setAssignSelectedSubjects] = useState(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignMode, setAssignMode] = useState('manual');
  const [randomCount, setRandomCount] = useState('');

  // Assign Mammo Tech (cases with an assessment submitted)
  const [assignMTModalOpen, setAssignMTModalOpen] = useState(false);
  const [assignMammoTechId, setAssignMammoTechId] = useState('');
  const [assignMTSelectedSubjects, setAssignMTSelectedSubjects] = useState(new Set());
  const [assigningMT, setAssigningMT] = useState(false);
  const [assignMTMode, setAssignMTMode] = useState('manual');
  const [mtRandomCount, setMtRandomCount] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subjectsData, radiologistsData, mammotechsData, assignmentsData] = await Promise.all([
        apiGet('/api/v1/qc/admin/subjects'),
        apiGet('/api/v1/qc/admin/radiologists'),
        apiGet('/api/v1/qc/admin/mammotechs'),
        apiGet('/api/v1/qc/admin/assignments'),
      ]);
      setSubjects(subjectsData);
      setRadiologists(radiologistsData);
      setMammotechs(mammotechsData);
      setAssignments(assignmentsData);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Mammo Tech assignment list: assessment_submitted = Yes (every subject qualifies —
  // every row here already has an assessment) and not yet assigned to a Mammo Tech.
  const mammoTechUnassigned = subjects.filter(s => s.mammo_tech_status === 'Unassigned');
  // Radiologist assignment list: status = Accepted (i.e. the Mammo Tech's image-quality
  // review passed). Both manual and random pools are capped at this same "how many
  // cases have been Accepted" count, so random-assign can never ask for more than
  // that — already-completed cases are still excluded server-side either way.
  const radiologistEligible = subjects.filter(s => s.mammo_tech_status === 'Accepted');

  const completedCount = assignments.filter(a => a.status === 'Completed').length;
  const pendingCount = assignments.length - completedCount;
  const acceptanceRate = assignments.length ? Math.round((completedCount / assignments.length) * 100) : 0;

  const createManualPool = createRole === 'Radiologist' ? radiologistEligible : mammoTechUnassigned;
  const createRandomPool = createManualPool;

  // Live validation for the "Number of Cases" inputs — computed on every render
  // instead of only at submit time, so the red error and the disabled Create/Assign
  // button stay in sync with whatever count is currently typed.
  const randomCountError = (countStr, pool, notEnoughMessage) => {
    if (countStr === '') return null;
    const count = Number(countStr);
    if (!count || count <= 0) return 'Enter a valid number of cases to randomly assign.';
    if (count > pool.length) return notEnoughMessage;
    return null;
  };

  const createRandomError = createAssignMode === 'random'
    ? randomCountError(createRandomCount, createRandomPool, createRole === 'Radiologist'
        ? `You have ${createRandomPool.length} case(s) accepted.`
        : `Only ${createRandomPool.length} eligible subject(s) available.`)
    : null;

  const assignRandomError = assignMode === 'random'
    ? randomCountError(randomCount, radiologistEligible, `You have ${radiologistEligible.length} case(s) accepted.`)
    : null;

  const assignMTRandomError = assignMTMode === 'random'
    ? randomCountError(mtRandomCount, mammoTechUnassigned, `Only ${mammoTechUnassigned.length} unassigned subject(s) available.`)
    : null;

  const handleCreateUser = async () => {
    if (!createForm.fullName || !createForm.email || !createForm.password) {
      alert('Full Name, Email and Password are required.');
      return;
    }
    // The Create button is disabled while createRandomError is set, but guard here
    // too in case the pool shrank between render and click.
    if (createAssignMode === 'random' && createRandomError) return;
    let caseIds;
    if (createAssignMode === 'random') {
      caseIds = pickRandomSubjects(createRandomPool, Number(createRandomCount));
    } else {
      caseIds = Array.from(createSelectedSubjects);
    }

    setCreating(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/users', {
        full_name: createForm.fullName,
        email: createForm.email,
        password: createForm.password,
        role: createRole,
        cases: caseIds,
      });
      const failedNote = result.failed_cases && result.failed_cases.length
        ? ` (${result.failed_cases.length} subject(s) could not be matched: ${result.failed_cases.join(', ')})`
        : '';
      alert(`${createRole} created and ${result.assigned_cases} case(s) assigned.${failedNote}`);
      setCreateForm({ fullName: '', email: '', password: '' });
      setCreateSelectedSubjects(new Set());
      setCreateRandomCount('');
      setCreateAssignMode('manual');
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
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
    // The Assign button is disabled while assignRandomError is set, but guard here
    // too in case the pool shrank between render and click.
    if (assignMode === 'random' && assignRandomError) return;

    let subjectIds;
    if (assignMode === 'random') {
      subjectIds = pickRandomSubjects(radiologistEligible, Number(randomCount));
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
      const notAcceptedNote = result.not_mammo_tech_accepted_subject_ids && result.not_mammo_tech_accepted_subject_ids.length
        ? ` ${result.not_mammo_tech_accepted_subject_ids.length} case(s) skipped — Mammo Tech review isn't Accepted yet.`
        : '';
      alert(`Assigned ${result.assigned_count} subject(s)${result.reassigned_count ? ` (${result.reassigned_count} reassigned)` : ''}.` +
        (result.blocked_completed_subject_ids.length ? ` ${result.blocked_completed_subject_ids.length} already-completed case(s) were skipped.` : '') +
        notAcceptedNote);
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
    setMtRandomCount('');
  };

  const handleAssignMammoTech = async () => {
    if (!assignMammoTechId) {
      alert('Select a Mammo Tech.');
      return;
    }
    // The Assign button is disabled while assignMTRandomError is set, but guard
    // here too in case the pool shrank between render and click.
    if (assignMTMode === 'random' && assignMTRandomError) return;

    let subjectIds;
    if (assignMTMode === 'random') {
      subjectIds = pickRandomSubjects(mammoTechUnassigned, Number(mtRandomCount));
    } else {
      if (assignMTSelectedSubjects.size === 0) {
        alert('Select a Mammo Tech and at least one subject.');
        return;
      }
      subjectIds = Array.from(assignMTSelectedSubjects);
    }

    setAssigningMT(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/assign-mammotech', {
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
      {/* Left column — two charts stacked */}
      <div style={chartsColumnStyle}>
        <div style={chartSlotStyle}>
          <DonutStat
            title="Progress"
            completed={completedCount}
            total={assignments.length}
            pending={pendingCount}
            extraLabel="Acceptance"
            extraValue={`${acceptanceRate}%`}
          />
        </div>
      </div>

      {/* Right column — Create User */}
      <div style={formColumnStyle}>
        <div style={{ ...cardStyle, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...cardTitleStyle, marginBottom: 0 }}>Create User</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setAssignMTModalOpen(true)} style={secondaryButtonStyle}>
                Assign Mammo Tech
              </button>
              <button type="button" onClick={() => setAssignModalOpen(true)} style={secondaryButtonStyle}>
                Assign Radiologist
              </button>
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Role</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setCreateRole('Mammo Tech'); setCreateSelectedSubjects(new Set()); }}
                style={modeButtonStyle(createRole === 'Mammo Tech')}>
                Mammo Tech
              </button>
              <button type="button" onClick={() => { setCreateRole('Radiologist'); setCreateSelectedSubjects(new Set()); }}
                style={modeButtonStyle(createRole === 'Radiologist')}>
                Radiologist
              </button>
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Full Name</label>
            <input
              style={inputStyle}
              name="qc-new-user-name"
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
              name="qc-new-user-email"
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
                name="qc-new-user-password"
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              <span onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}>
                {showPassword ? '🙈' : '👁️'}
              </span>
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Assignment Mode</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setCreateAssignMode('random')}
                style={modeButtonStyle(createAssignMode === 'random')}>
                Random Assign
              </button>
              <button type="button" onClick={() => setCreateAssignMode('manual')}
                style={modeButtonStyle(createAssignMode === 'manual')}>
                Select Manually
              </button>
            </div>
          </div>

          {createAssignMode === 'manual' ? (
            <div style={fieldStyle}>
              <label style={labelStyle}>Assign Subjects</label>
              <CheckboxDropdown
                label="Select Subjects"
                options={createManualPool}
                getId={(s) => s.qc_subject_id}
                getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'}`}
                selected={createSelectedSubjects}
                onChange={setCreateSelectedSubjects}
              />
            </div>
          ) : (
            <div style={fieldStyle}>
              <label style={labelStyle}>Number of Cases</label>
              <input
                style={inputStyle}
                type="number"
                min="1"
                max={createRandomPool.length}
                placeholder="e.g. 50"
                value={createRandomCount}
                onChange={(e) => setCreateRandomCount(e.target.value)}
              />
              {createRandomError && <div style={errorTextStyle}>{createRandomError}</div>}
            </div>
          )}

          {/* marginTop:auto pins this to the bottom edge of the card, so it
              lands on the same line as the bottom of the Subjects card. */}
          <div style={formFooterStyle}>
            <div style={{ fontSize: 12, color: '#888' }}>
              Total Subjects with Assessments: {subjects.length} · Eligible for {createRole}: {createManualPool.length}
            </div>
            <button type="button" disabled={creating || !!createRandomError} onClick={handleCreateUser}
              style={{ ...primaryButtonStyle, opacity: (creating || createRandomError) ? 0.7 : 1 }}>
              {creating ? 'Creating...' : `Create ${createRole}`}
            </button>
          </div>
        </div>
      </div>

      {assignMTModalOpen && (
        <div style={modalOverlayStyle} onClick={closeAssignMTModal}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Assign Mammo Tech</h3>
            <div style={fieldStyle}>
              <label style={labelStyle}>Mammo Tech</label>
              <SearchableSelect
                placeholder="Select Mammo Tech"
                options={mammotechs}
                getId={(m) => m.id}
                getLabel={(m) => `${m.full_name || m.email} (${m.email})`}
                value={assignMammoTechId}
                onChange={setAssignMammoTechId}
              />
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
                  options={mammoTechUnassigned}
                  getId={(s) => s.qc_subject_id}
                  getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'}`}
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
                  max={mammoTechUnassigned.length}
                  placeholder="e.g. 50"
                  value={mtRandomCount}
                  onChange={(e) => setMtRandomCount(e.target.value)}
                />
                {assignMTRandomError && <div style={errorTextStyle}>{assignMTRandomError}</div>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeAssignMTModal} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" disabled={assigningMT || !!assignMTRandomError} onClick={handleAssignMammoTech}
                style={{ ...primaryButtonStyle, opacity: (assigningMT || assignMTRandomError) ? 0.7 : 1 }}>
                {assigningMT ? 'Assigning...' : 'Assign Mammo Tech'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignModalOpen && (
        <div style={modalOverlayStyle} onClick={closeAssignModal}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Assign Radiologist</h3>
            <div style={fieldStyle}>
              <label style={labelStyle}>Radiologist</label>
              <SearchableSelect
                placeholder="Select Radiologist"
                options={radiologists}
                getId={(r) => r.id}
                getLabel={(r) => `${r.full_name || r.email} (${r.email})`}
                value={assignRadiologistId}
                onChange={setAssignRadiologistId}
              />
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
                  options={radiologistEligible}
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
                  max={radiologistEligible.length}
                  placeholder="e.g. 50"
                  value={randomCount}
                  onChange={(e) => setRandomCount(e.target.value)}
                />
                {assignRandomError && <div style={errorTextStyle}>{assignRandomError}</div>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeAssignModal} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" disabled={assigning || !!assignRandomError} onClick={handleAssignRadiologist}
                style={{ ...primaryButtonStyle, opacity: (assigning || assignRandomError) ? 0.7 : 1 }}>
                {assigning ? 'Assigning...' : 'Assign Radiologist'}
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

const chartsColumnStyle = {
  flex: '0 0 360px',
  minWidth: 360,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

// Each chart takes an equal share of the column height.
const chartSlotStyle = { flex: 1, display: 'flex' };

const formColumnStyle = { flex: '1 1 480px', minWidth: 320, display: 'flex' };

/* ---------- Cards ---------- */

// height:100% + column flex lets each card fill its stretched column.
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

// Chart area absorbs the extra height and keeps the donut/pie optically centred.
const cardBodyStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 160,
};

// Stats/legend sit flush at the bottom of the card.
const cardFooterStyle = {
  borderTop: '1px solid #f1f5f7',
  marginBottom: 50,
  paddingTop: 30,
};

const cardTitleStyle = { fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 12 };

const donutCenterStyle = {
  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center',
};

/* ---------- Form ---------- */

const formFooterStyle = {
  marginTop: 'auto',
  paddingTop: 14,
  borderTop: '1px solid #f1f5f7',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const errorTextStyle = { fontSize: 12, color: '#dc3545', marginTop: 6, fontWeight: 600 };

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

const ddSearchInputStyle = {
  position: 'sticky', top: 0, zIndex: 1, width: '100%', boxSizing: 'border-box',
  padding: '8px 12px', fontSize: 13, border: 'none', borderBottom: '1px solid #e0e0e0',
  background: '#fff', outline: 'none',
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
