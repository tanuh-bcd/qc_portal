import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell } from 'recharts';

const API_BASE = process.env.REACT_APP_API_URL || '';

const RISK_COLORS = { Baseline: '#6ee7b7', Evident: '#fde047', Significant: '#fb923c', High: '#fb7185' };
const RISK_ORDER = ['Baseline', 'Evident', 'Significant', 'High'];

const authHeaders = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}` });

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
        <span style={{ marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
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

const DonutStat = ({ title, completed, total, pending, extraLabel, extraValue }) => {
  const data = total > 0
    ? [{ name: 'Completed', value: completed }, { name: 'Pending', value: total - completed }]
    : [{ name: 'Pending', value: 1 }];
  return (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>{title}</div>
      <div style={{ position: 'relative', width: 160, height: 160, margin: '0 auto' }}>
        <PieChart width={160} height={160}>
          <Pie data={data} dataKey="value" innerRadius={48} outerRadius={70} startAngle={90} endAngle={-270}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.name === 'Completed' ? '#f5a623' : '#fde68a'} stroke="none" />
            ))}
          </Pie>
        </PieChart>
        <div style={donutCenterStyle}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{completed} / {total}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Completed</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Pending</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#b0691c' }}>{pending}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>{extraLabel}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#14868C' }}>{extraValue}</div>
        </div>
      </div>
    </div>
  );
};

const SubjectsPie = ({ assigned, unassigned }) => {
  const total = assigned + unassigned || 1;
  const data = [{ name: 'Assigned', value: assigned }, { name: 'Unassigned', value: unassigned }];
  const pct = (v) => Math.round((v / total) * 100);
  return (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>Subjects</div>
      <div style={{ width: 160, height: 160, margin: '0 auto' }}>
        <PieChart width={160} height={160}>
          <Pie data={data} dataKey="value" outerRadius={70} label={({ name }) => (name === 'Assigned' ? `${pct(assigned)}%` : `${pct(unassigned)}%`)}>
            <Cell fill="#14868C" stroke="none" />
            <Cell fill="#a7e8d0" stroke="none" />
          </Pie>
        </PieChart>
      </div>
      <div style={{ marginTop: 8, fontSize: 13 }}>
        <div style={legendRowStyle}><span style={{ ...legendDotStyle, background: '#14868C' }} />Assigned&nbsp;<strong>{assigned} ({pct(assigned)}%)</strong></div>
        <div style={legendRowStyle}><span style={{ ...legendDotStyle, background: '#a7e8d0' }} />Unassigned&nbsp;<strong>{unassigned} ({pct(unassigned)}%)</strong></div>
        <div style={{ marginTop: 6, color: '#888' }}>Total Subjects&nbsp;<strong>{total === 1 && assigned + unassigned === 0 ? 0 : assigned + unassigned}</strong></div>
      </div>
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
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [createForm, setCreateForm] = useState({ fullName: '', email: '', password: '' });
  const [createSelectedSubjects, setCreateSelectedSubjects] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignRadiologistId, setAssignRadiologistId] = useState('');
  const [assignSelectedSubjects, setAssignSelectedSubjects] = useState(new Set());
  const [assigning, setAssigning] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subjectsData, radiologistsData, assignmentsData] = await Promise.all([
        apiGet('/api/v1/qc/admin/subjects'),
        apiGet('/api/v1/qc/admin/radiologists'),
        apiGet('/api/v1/qc/admin/assignments'),
      ]);
      setSubjects(subjectsData);
      setRadiologists(radiologistsData);
      setAssignments(assignmentsData);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const unassignedSubjects = subjects.filter(s => s.assignment_status === 'Unassigned');
  const assignedCount = subjects.length - unassignedSubjects.length;
  const completedCount = assignments.filter(a => a.status === 'Completed').length;
  const pendingCount = assignments.length - completedCount;
  const acceptanceRate = assignments.length ? Math.round((completedCount / assignments.length) * 100) : 0;

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
      const result = await apiPost('/api/v1/qc/admin/users', {
        full_name: createForm.fullName,
        email: createForm.email,
        password: createForm.password,
        role: 'Radiologist',
        cases: Array.from(createSelectedSubjects),
      });
      const failedNote = result.failed_cases && result.failed_cases.length
        ? ` (${result.failed_cases.length} subject(s) could not be matched: ${result.failed_cases.join(', ')})`
        : '';
      alert(`Radiologist created and ${result.assigned_cases} case(s) assigned.${failedNote}`);
      setCreateForm({ fullName: '', email: '', password: '' });
      setCreateSelectedSubjects(new Set());
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleAssignRadiologist = async () => {
    if (!assignRadiologistId || assignSelectedSubjects.size === 0) {
      alert('Select a radiologist and at least one subject.');
      return;
    }
    setAssigning(true);
    try {
      const result = await apiPost('/api/v1/qc/admin/assign-radiologist', {
        radiologist_id: Number(assignRadiologistId),
        subject_ids: Array.from(assignSelectedSubjects),
      });
      alert(`Assigned ${result.assigned_count} subject(s)${result.reassigned_count ? ` (${result.reassigned_count} reassigned)` : ''}.` +
        (result.blocked_completed_subject_ids.length ? ` ${result.blocked_completed_subject_ids.length} already-completed case(s) were skipped.` : ''));
      setAssignModalOpen(false);
      setAssignRadiologistId('');
      setAssignSelectedSubjects(new Set());
      loadAll();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setAssigning(false);
    }
  };

  if (loading) return <p style={{ padding: 20 }}>Loading QC dashboard...</p>;
  if (error) return <p style={{ padding: 20, color: 'red' }}>{error}</p>;

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DonutStat
          title="Progress"
          completed={completedCount}
          total={assignments.length}
          pending={pendingCount}
          extraLabel="Acceptance"
          extraValue={`${acceptanceRate}%`}
        />
        <SubjectsPie assigned={assignedCount} unassigned={unassignedSubjects.length} />
      </div>

      <div style={{ flex: '1 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...cardStyle, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={cardTitleStyle}>Create Radiologist</div>
            <button type="button" onClick={() => setAssignModalOpen(true)} style={secondaryButtonStyle}>
              Assign Radiologist
            </button>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Full Name</label>
            <input style={inputStyle} value={createForm.fullName}
              onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>User Email</label>
            <input style={inputStyle} type="email" value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input style={inputStyle} type={showPassword ? 'text' : 'password'} value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              <span onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}>
                {showPassword ? '🙈' : '👁️'}
              </span>
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Assign Subjects</label>
            <CheckboxDropdown
              label="Select Subjects"
              options={unassignedSubjects}
              getId={(s) => s.qc_subject_id}
              getLabel={(s) => `${s.qc_subject_id} — ${s.hospital_name || 'Unknown hospital'}`}
              selected={createSelectedSubjects}
              onChange={setCreateSelectedSubjects}
            />
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Total Subjects: {subjects.length}</div>
          <button type="button" disabled={creating} onClick={handleCreateRadiologist}
            style={{ ...primaryButtonStyle, opacity: creating ? 0.7 : 1 }}>
            {creating ? 'Creating...' : 'Create Radiologist'}
          </button>
        </div>
      </div>

      {assignModalOpen && (
        <div style={modalOverlayStyle} onClick={() => setAssignModalOpen(false)}>
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
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAssignModalOpen(false)} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" disabled={assigning} onClick={handleAssignRadiologist}
                style={{ ...primaryButtonStyle, opacity: assigning ? 0.7 : 1 }}>
                {assigning ? 'Assigning...' : 'Assign Radiologist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const cardStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e0e7eb',
  borderRadius: 12,
  padding: 18,
  textAlign: 'center',
};

const cardTitleStyle = { fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 12 };

const donutCenterStyle = {
  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center',
};

const legendRowStyle = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const legendDotStyle = { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' };

const fieldStyle = { marginBottom: 14 };
const labelStyle = { display: 'block', marginBottom: 5, fontWeight: 500, fontSize: 13 };
const inputStyle = { width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' };

const primaryButtonStyle = {
  padding: '10px 20px', backgroundColor: '#14868C', color: 'white', border: 'none',
  borderRadius: 4, cursor: 'pointer', fontWeight: 'bold',
};

const secondaryButtonStyle = {
  padding: '8px 16px', backgroundColor: '#fff', color: '#14868C', border: '1.5px solid #14868C',
  borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: 13,
};

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
