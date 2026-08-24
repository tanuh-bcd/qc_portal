import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Layout from '../Layout';

const pageWrapStyle = {
  backgroundColor: '#ffffff',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '16px 20px',
  boxSizing: 'border-box'
};

const tabContainerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: 'white',
  borderBottom: '1px solid #ddd',
  boxSizing: 'border-box',
};

const tabButtonStyle = {
  padding: '1px 30px',
  fontSize: '16px',
  background: 'none',
  border: 'none',
  borderBottom: '3px solid #14868C',
  color: '#14868C',
  fontWeight: 'bold',
};

// --- Dashboard row: sidebar + main content ---
const dashboardRowStyle = {
  display: 'flex',
  gap: '16px',
  alignItems: 'flex-start',
  width: '100%'
};

const sidebarStyle = {
  flex: '0 0 280px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px'
};

const mainContentStyle = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '16px'
};

// --- Sidebar cards ---
const sidebarCardStyle = {
  border: '1px solid #dee2e6',
  borderRadius: '8px',
  backgroundColor: '#ffffff',
  padding: '18px 20px',
  boxSizing: 'border-box'
};

const sidebarCardTitleStyle = {
  fontWeight: 700,
  fontSize: '14px',
  color: '#1a1a1a',
  marginBottom: '14px',
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
};

const donutWrapStyle = {
  display: 'flex',
  justifyContent: 'center',
  position: 'relative'
};

const donutCenterTextStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  textAlign: 'center'
};

const donutValueStyle = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#1a1a1a'
};

const donutSubStyle = {
  fontSize: '10px',
  color: '#888',
  marginTop: '2px'
};

const miniStatsRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: '16px',
  paddingTop: '14px',
  borderTop: '1px solid #eee'
};

const miniStatColStyle = { textAlign: 'left' };

const miniStatLabelStyle = {
  fontSize: '11px',
  color: '#888',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.3px'
};

const miniStatValueStyle = (color) => ({
  fontSize: '20px',
  fontWeight: 700,
  color,
  marginTop: '2px'
});

const riskBarRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '12px'
};

const riskBarLabelWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flex: '0 0 120px',
  fontSize: '12px',
  color: '#444'
};

const riskDotStyle = (color) => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: color,
  flexShrink: 0
});

const riskBarTrackStyle = {
  flex: 1,
  height: '8px',
  backgroundColor: '#f1f3f5',
  borderRadius: '4px',
  overflow: 'hidden'
};

const riskBarCountStyle = {
  fontSize: '12px',
  color: '#555',
  fontWeight: 600,
  minWidth: '18px',
  textAlign: 'right'
};

// --- Pie chart (Subjects: assigned vs unassigned) ---
const PIE_ASSIGNED_COLOR = '#f1c40f';
const PIE_UNASSIGNED_COLOR = '#6ee7b7';

const pieWrapStyle = {
  display: 'flex',
  justifyContent: 'center'
};

const legendRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: '10px',
  fontSize: '12.5px',
  color: '#444'
};

const legendLabelWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
};

const legendCountStyle = {
  fontWeight: 700,
  color: '#1a1a1a'
};

// --- Existing styles below (unchanged) ---
const cardStyle = {
  border: '1px solid #dee2e6',
  borderRadius: '8px',
  backgroundColor: '#ffffff',
  width: '100%',
  boxSizing: 'border-box'
};

const cardHeaderStyle = {
  padding: '18px 20px',
  fontWeight: 'bold',
  fontSize: '17px',
  color: '#1a1a1a',
  borderRadius: '8px 8px 0 0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
  userSelect: 'none'
};

const fieldWrapStyle = { padding: '0 20px 20px' };

const fieldGroupStyle = { marginBottom: '16px', position: 'relative' };

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  fontWeight: 500,
  fontSize: '14px',
  color: '#333'
};

const buttonStyle = {
  padding: '10px 20px',
  backgroundColor: '#14868C',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold'
};

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const modalStyle = {
  backgroundColor: 'white',
  padding: '24px',
  borderRadius: '8px',
  minWidth: '280px',
  textAlign: 'center'
};

const modalActionsStyle = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'center',
  marginTop: '16px'
};

const modalYesStyle = {
  padding: '8px 20px',
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: '#14868C',
  color: 'white'
};

const modalNoStyle = {
  padding: '8px 20px',
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: '#eee',
  color: '#333'
};

// --- Searchable dropdown styles ---
const ddTriggerStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid #cfd8dc',
  backgroundColor: 'white',
  fontSize: '14px',
  boxSizing: 'border-box',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '8px'
};

const ddTriggerTextStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#333'
};

const ddPanelStyle = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  backgroundColor: 'white',
  border: '1px solid #cfd8dc',
  borderRadius: '6px',
  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
  zIndex: 20,
  overflow: 'hidden'
};

const ddSearchWrapStyle = {
  padding: '8px',
  borderBottom: '1px solid #eee'
};

const ddSearchInputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '4px',
  border: '1px solid #cfd8dc',
  fontSize: '13px',
  boxSizing: 'border-box'
};

const DROPDOWN_LIST_HEIGHT = 220;

const ddListStyle = {
  height: DROPDOWN_LIST_HEIGHT,
  overflowY: 'auto'
};

const ddOptionStyle = {
  padding: '9px 12px',
  fontSize: '14px',
  color: '#333',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
};

const ddOptionHoverStyle = {
  backgroundColor: '#f0f0f0'
};

const ddEmptyStyle = {
  padding: '14px 12px',
  fontSize: '13px',
  color: '#888',
  textAlign: 'center'
};

const qcThStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  color: '#495057',
  fontWeight: '600',
  whiteSpace: 'nowrap',
  backgroundColor: '#DAF3F4',
  borderRight: '1px solid #dee2e6',
  borderBottom: '1px solid #dee2e6',
};

const qcTdStyle = {
  padding: '10px 12px',
  backgroundColor: '#fff',
  borderRight: '1px solid #dee2e6',
  borderBottom: '1px solid #dee2e6',
};

const RISK_COLORS = {
  'Baseline Risk': '#6ee7b7',
  'Evident Risk': '#fde047',
  'Significant Risk': '#fb923c',
  'High Risk': '#fb7185'
};

const RISK_ORDER = ['Baseline Risk', 'Evident Risk', 'Significant Risk', 'High Risk'];

const statusCellStyle = (isTrue) => ({
  padding: '10px 12px',
  textAlign: 'left',
  color: isTrue ? 'green' : 'red',
  fontWeight: 'bold',
  borderRight: '1px solid #dee2e6',
});

const tableSectionStyle = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const sectionLabelStyle = {
  fontWeight: 600,
  fontSize: '20px',
  color: '#14868C',
  padding: '8px 5px'
};

// --- Small donut chart (SVG, no external deps) ---
const DonutGauge = ({ completed, total, size = 150, stroke = 24, color = 'rgb(253, 224, 71)' }) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, completed / total) : 0;
  const offset = circumference * (1 - pct);

  return (
    <div style={{ ...donutWrapStyle, width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#fb923c"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div style={donutCenterTextStyle}>
        <div style={donutValueStyle}>{completed} / {total}</div>
        <div style={donutSubStyle}>Completed</div>
      </div>
    </div>
  );
};

const polarToCartesian = (cx, cy, r, angleDeg) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const describeArc = (cx, cy, r, startAngle, endAngle) => {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

const SubjectsPie = ({ assigned, total, size = 140 }) => {
  const pct = total > 0 ? Math.min(100, (assigned / total) * 100) : 0;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  const assignedAngle = (pct / 100) * 360;
  const labelR = r * 0.68;

  const assignedMid = assignedAngle / 2;
  const unassignedMid = assignedAngle + (360 - assignedAngle) / 2;

  const assignedLabelPos = polarToCartesian(cx, cy, labelR, assignedMid);
  const unassignedLabelPos = polarToCartesian(cx, cy, labelR, unassignedMid);

  const assignedPct = Math.round(pct);
  const unassignedPct = 100 - assignedPct;

  return (
    <div style={{ ...pieWrapStyle, width: size, margin: '0 auto' }}>
      <svg width={size} height={size}>
        {total > 0 && assignedAngle < 360 && (
          <path d={describeArc(cx, cy, r, assignedAngle, 360)} fill={PIE_UNASSIGNED_COLOR} />
        )}
        {total > 0 && assignedAngle > 0 && (
          <path d={describeArc(cx, cy, r, 0, assignedAngle)} fill={PIE_ASSIGNED_COLOR} />
        )}
        {total > 0 && pct > 0 && (
          <text
            x={assignedLabelPos.x}
            y={assignedLabelPos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={assignedPct < 12 ? '9' : '11'}
            fontWeight="700"
            fill="#5c4a00"
          >
            {assignedPct}%
          </text>
        )}
        {total > 0 && pct < 100 && (
          <text
            x={unassignedLabelPos.x}
            y={unassignedLabelPos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={unassignedPct < 12 ? '9' : '11'}
            fontWeight="700"
            fill="#0f5132"
          >
            {unassignedPct}%
          </text>
        )}
      </svg>
    </div>
  );
};

const SearchableDropdown = ({
  options,
  getValue,
  getLabel,
  getDisabled = () => false,
  multiple = false,
  selected,
  onChange,
  placeholder,
  loading,
  emptyText = 'No results found'
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hoverIdx, setHoverIdx] = useState(-1);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter((opt) =>
    getLabel(opt).toLowerCase().includes(query.toLowerCase())
  );

  const isSelected = (opt) =>
    multiple
      ? selected.includes(getValue(opt))
      : selected === getValue(opt);

  const handleSelect = (opt) => {
    if (getDisabled(opt)) return;
    if (multiple) {
      const val = getValue(opt);
      const next = selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val];
      onChange(next);
    } else {
      onChange(getValue(opt));
      setOpen(false);
      setQuery('');
    }
  };

  const triggerLabel = () => {
    if (loading) return 'Loading...';
    if (multiple) {
      if (selected.length === 0) return placeholder;
      if (selected.length === 1) {
        const opt = options.find((o) => getValue(o) === selected[0]);
        return opt ? getLabel(opt) : `1 selected`;
      }
      return `${selected.length} selected`;
    }
    const opt = options.find((o) => getValue(o) === selected);
    return opt ? getLabel(opt) : placeholder;
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={ddTriggerStyle}
        onClick={() => !loading && setOpen((o) => !o)}
        disabled={loading}
      >
        <span style={ddTriggerTextStyle}>{triggerLabel()}</span>
        <span style={{ color: '#888', fontSize: '11px' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={ddPanelStyle}>
          <div style={ddSearchWrapStyle}>
            <input
              autoFocus
              type="text"
              placeholder="Search..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHoverIdx(-1); }}
              style={ddSearchInputStyle}
            />
          </div>
          <div style={ddListStyle}>
            {filtered.length === 0 && <div style={ddEmptyStyle}>{emptyText}</div>}
            {filtered.map((opt, idx) => {
              const val = getValue(opt);
              const selectedFlag = isSelected(opt);
              const disabled = getDisabled(opt);
              return (
                <div
                  key={val}
                  style={{
                    ...ddOptionStyle,
                    ...(hoverIdx === idx && !disabled ? ddOptionHoverStyle : {}),
                    ...(selectedFlag && !multiple ? { backgroundColor: '#E6F4F1' } : {}),
                    ...(disabled ? { opacity: 0.45, cursor: 'not-allowed', backgroundColor: '#f5f5f5' } : {})
                  }}
                  onMouseEnter={() => !disabled && setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(-1)}
                  onClick={() => handleSelect(opt)}
                >
                  {multiple && (
                    <input
                      type="checkbox"
                      checked={selectedFlag}
                      readOnly
                      disabled={disabled}
                      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
                    />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {getLabel(opt)}{disabled ? ' (Already Assigned)' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const QCAdminDashboard = () => {
  const navigate = useNavigate();

  // --- Auth guard ---
  const [qcRole, setQcRole] = useState('');
  const [qcUserName, setQcUserName] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('qcRole');
    const token = localStorage.getItem('qcToken');
    const userName = localStorage.getItem('qcUserName');

    if (!token || !role) {
      navigate('/qc-bcd-login');
      return;
    }

    setQcRole(role);
    setQcUserName(userName || '');
    setAuthChecked(true);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('qcToken');
    localStorage.removeItem('qcRole');
    localStorage.removeItem('qcUserEmail');
    localStorage.removeItem('qcUserName');
    navigate('/qc-bcd-login');
  };
  // -------------------

  const apiBase = process.env.REACT_APP_API_URL || '';
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('qcToken')}`
  };
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [allAssignments, setAllAssignments] = useState([]);
  const [allAssignmentsLoading, setAllAssignmentsLoading] = useState(true);
  const [selectedAdminSubject, setSelectedAdminSubject] = useState(null);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminDetailLoading, setAdminDetailLoading] = useState(false);
  const [totalSubjects, setTotalSubjects] = useState(0);

  const [isCreateExpanded, setIsCreateExpanded] = useState(true);

  const fetchAdminSubjectDetail = async (sessionId, radiologistId) => {
    setAdminDetailLoading(true);
    try {
      const response = await fetch(
        `${apiBase}/api/v1/qc/radiologist/${radiologistId}/subjects/${sessionId}`,
        { headers: authHeaders }
      );
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch subject details');
      const data = await response.json();
      setSelectedAdminSubject(data);
      setIsAdminModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch subject details', err);
      toast.error('An error occurred while loading subject details');
    } finally {
      setAdminDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchUsers();
    fetchSubjects();
    fetchAllAssignments();
    // eslint-disable-next-line
  }, [authChecked]);

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/qc/users`, { headers: authHeaders });
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch users', err);
      toast.error('Failed to load users list');
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchSubjects = async () => {
    setSubjectsLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/qc/subjects-list`, { headers: authHeaders });
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch subjects');
      const data = await response.json();
      const list = Array.isArray(data?.subjects) ? data.subjects : [];
      setSubjects(list);
      setTotalSubjects(typeof data?.total === 'number' ? data.total : list.length);
    } catch (err) {
      console.error('Failed to fetch subjects', err);
      toast.error('Failed to load subjects list');
    } finally {
      setSubjectsLoading(false);
    }
  };

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleCreateClick = () => {
    const trimmedEmail = email.trim();
    const trimmedName = fullName.trim();

    if (!trimmedName || !trimmedEmail || !password || selectedSubjects.length === 0) {
      toast.error('Please enter full name, email, password, and select at least one subject');
      return;
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    setShowConfirm(true);
  };

  const confirmCreate = async () => {
    setCreating(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/qc/assignments`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          assessment_ids: selectedSubjects.map(Number),
          full_name: fullName.trim(),
          email: email.trim(),
          password: password,
          role: 'QC Radiologist',
          assigned: 'yes'
        })
      });
      const data = await response.json();
      if (response.ok) {
        const createdCount = data.created?.length || 0;
        const skippedCount = data.skipped?.length || 0;
        toast.success(
          `${createdCount} stud${createdCount === 1 ? 'y' : 'ies'} created` +
          (skippedCount ? `, ${skippedCount} already assigned` : '')
        );
        setFullName('');
        setEmail('');
        setPassword('');
        setSelectedSubjects([]);
        fetchAllAssignments();
      } else {
        toast.error(data.detail || 'Failed to create study');
      }
    } catch (err) {
      console.error('Create study error', err);
      toast.error('An error occurred while creating the study');
    } finally {
      setCreating(false);
      setShowConfirm(false);
    }
  };

  const fetchAllAssignments = async () => {
    setAllAssignmentsLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/qc/admin/all/assignments`, { headers: authHeaders });
      if (response.status === 401) {
        toast.error('Session expired, please log in again');
        navigate('/qc-bcd-login');
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch assignments');
      const data = await response.json();
      setAllAssignments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch assignments', err);
      toast.error('Failed to load assignments');
    } finally {
      setAllAssignmentsLoading(false);
    }
  };

  const selectedSubjectLabels = subjects
    .filter((s) => selectedSubjects.includes(String(s.qc_id)))
    .map((s) => s.display_id);

  const totalAssigned = allAssignments.length;
  const totalCompleted = allAssignments.filter((a) => a.qc_status === 'Completed').length;
  const totalPending = totalAssigned - totalCompleted;
  const acceptanceRate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

  // risk category breakdown for sidebar bar chart
  const riskCounts = allAssignments.reduce((acc, a) => {
    if (a.risk_category) acc[a.risk_category] = (acc[a.risk_category] || 0) + 1;
    return acc;
  }, {});
  const riskMax = Math.max(1, ...RISK_ORDER.map((k) => riskCounts[k] || 0));

  // NEW - subjects assigned vs unassigned for pie chart
  const assignedSubjectsCount = subjects.filter((s) => s.is_assigned).length;
  const unassignedSubjectsCount = Math.max(0, totalSubjects - assignedSubjectsCount);

  return (
    <Layout userRole={qcRole} handleLogout={handleLogout} fullWidth={true}>
      <div style={pageWrapStyle}>
        <div style={tabContainerStyle}>
          <button style={tabButtonStyle}>QC Admin</button>
          <span style={{ fontSize: '14px', color: '#666' }}>
            {qcUserName ? `Logged in as ${qcUserName}` : ''}
          </span>
        </div>

        <div style={dashboardRowStyle}>
          {/* Sidebar: progress donut + subjects pie + risk breakdown bars */}
          <div style={sidebarStyle}>
            <div style={sidebarCardStyle}>
              <div style={sidebarCardTitleStyle}>Progress</div>
              <DonutGauge
                completed={allAssignmentsLoading ? 0 : totalCompleted}
                total={allAssignmentsLoading ? 0 : totalAssigned}
              />
              <div style={miniStatsRowStyle}>
                <div style={miniStatColStyle}>
                  <div style={miniStatLabelStyle}>Pending</div>
                  <div style={miniStatValueStyle('#8A6D00')}>
                    {allAssignmentsLoading ? '…' : totalPending}
                  </div>
                </div>
                <div style={miniStatColStyle}>
                  <div style={miniStatLabelStyle}>Acceptance</div>
                  <div style={miniStatValueStyle('#1E7B34')}>
                    {allAssignmentsLoading ? '…' : `${acceptanceRate}%`}
                  </div>
                </div>
              </div>
            </div>

            {/* NEW - Subjects pie chart */}
            <div style={sidebarCardStyle}>
              <div style={sidebarCardTitleStyle}>Subjects</div>
              <SubjectsPie
                assigned={subjectsLoading ? 0 : assignedSubjectsCount}
                total={subjectsLoading ? 0 : totalSubjects}
              />
              <div style={legendRowStyle}>
                <div style={legendLabelWrapStyle}>
                  <span style={riskDotStyle(PIE_ASSIGNED_COLOR)} />
                  <span>Assigned</span>
                </div>
                <span style={legendCountStyle}>
                  {subjectsLoading
                    ? '…'
                    : `${assignedSubjectsCount} (${totalSubjects > 0 ? Math.round((assignedSubjectsCount / totalSubjects) * 100) : 0}%)`}
                </span>
              </div>
              <div style={legendRowStyle}>
                <div style={legendLabelWrapStyle}>
                  <span style={riskDotStyle(PIE_UNASSIGNED_COLOR)} />
                  <span>Unassigned</span>
                </div>
                <span style={legendCountStyle}>
                  {subjectsLoading
                    ? '…'
                    : `${unassignedSubjectsCount} (${totalSubjects > 0 ? Math.round((unassignedSubjectsCount / totalSubjects) * 100) : 0}%)`}
                </span>
              </div>
              <div style={{ ...legendRowStyle, marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #eee' }}>
                <span style={{ color: '#888' }}>Total Subjects</span>
                <span style={legendCountStyle}>
                  {subjectsLoading ? '…' : totalSubjects}
                </span>
              </div>
            </div>

            <div style={sidebarCardStyle}>
              <div style={sidebarCardTitleStyle}>Risk Breakdown</div>
              {RISK_ORDER.map((label) => {
                const count = riskCounts[label] || 0;
                const widthPct = (count / riskMax) * 100;
                return (
                  <div key={label} style={riskBarRowStyle}>
                    <div style={riskBarLabelWrapStyle}>
                      <span style={riskDotStyle(RISK_COLORS[label])} />
                      <span>{label.replace(' Risk', '')}</span>
                    </div>
                    <div style={riskBarTrackStyle}>
                      <div
                        style={{
                          width: `${widthPct}%`,
                          height: '100%',
                          backgroundColor: RISK_COLORS[label],
                          borderRadius: '4px',
                          transition: 'width 0.4s ease'
                        }}
                      />
                    </div>
                    <span style={riskBarCountStyle}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main content: create-study card + table */}
          <div style={mainContentStyle}>
            <div style={cardStyle}>
              <div
                style={cardHeaderStyle}
                onClick={() => setIsCreateExpanded((v) => !v)}
              >
                <span style={{
                  fontWeight: 600,
                  fontSize: '20px',
                  color: '#14868C',
                }}>Create New Study</span>
                <span style={{ fontSize: '20px', color: '#14868C' }}>
                  {isCreateExpanded ? '-' : '+'}
                </span>
              </div>
              {isCreateExpanded && (
                <div style={fieldWrapStyle}>
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Dr. Jane Doe"
                      autoComplete="off"
                      name="qc-assign-fullname"
                      style={ddTriggerStyle}
                    />
                  </div>

                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>User Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="user@example.com"
                      autoComplete="off"
                      name="qc-assign-email"
                      style={ddTriggerStyle}
                    />
                  </div>

                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Set login password for this user"
                        autoComplete="new-password"
                        name="qc-assign-password"
                        style={{ ...ddTriggerStyle, paddingRight: '38px' }}
                      />
                      <span
                        onClick={() => setShowPassword((s) => !s)}
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          cursor: 'pointer',
                          fontSize: '15px'
                        }}
                      >
                        {showPassword ? '🙈' : '👁️'}
                      </span>
                    </div>
                  </div>

                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>Assign Subjects</label>
                    <SearchableDropdown
                      options={subjects}
                      getValue={(s) => String(s.qc_id)}
                      getLabel={(s) => s.display_id}
                      getDisabled={(s) => s.is_assigned}
                      multiple={true}
                      selected={selectedSubjects}
                      onChange={setSelectedSubjects}
                      placeholder="Select Subjects"
                      loading={subjectsLoading}
                      emptyText="No subjects found"
                    />
                    <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#555' }}>
                      Total Subjects: {subjectsLoading ? '…' : totalSubjects}
                    </div>
                    {selectedSubjects.length > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#555' }}>
                        {selectedSubjects.length} selected: {selectedSubjectLabels.join(', ')}
                      </div>
                    )}
                  </div>

                  <button
                    style={{ ...buttonStyle, opacity: creating ? 0.7 : 1 }}
                    onClick={handleCreateClick}
                    disabled={creating}
                  >
                    Create New Study
                  </button>
                </div>
              )}
            </div>

            <div style={tableSectionStyle}>
              <span style={sectionLabelStyle}>Admin Assigned History</span>

              <div
                style={{
                  maxHeight: '80vh',
                  overflowY: 'auto',
                  overflowX: 'auto',
                  border: '1px solid #dee2e6',
                  borderRadius: '6px',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: '1000px',
                    backgroundColor: '#fff',
                    border: '1px solid #dee2e6',
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Subject ID
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Radiologist
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Email
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Hospital
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Risk
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Assessment
                      </th>
                      <th style={{ ...qcThStyle, position: 'sticky', top: 0, zIndex: 1 }}>
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {allAssignments.map((a) => (
                      <tr
                        key={a.qc_assignment_id}
                        style={{
                          borderBottom: '1px solid #dee2e6',
                        }}
                      >
                        <td style={qcTdStyle}>{a.display_id || a.id?.substring(0, 8)}</td>
                        <td style={qcTdStyle}>{a.radiologist_name || '—'}</td>
                        <td style={qcTdStyle}>{a.radiologist_email}</td>
                        <td style={{ ...qcTdStyle, fontSize: 12 }}>
                          {a.qc_short_name || '-'}
                        </td>

                        <td style={qcTdStyle}>
                          {a.risk_category ? (
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 12px',
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                backgroundColor: RISK_COLORS[a.risk_category] || '#eee',
                                color: '#111',
                              }}
                            >
                              {a.risk_category.replace(' Risk', '')}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>

                        <td style={statusCellStyle(a.has_assessment)}>
                          {a.has_assessment ? 'Yes' : 'No'}
                        </td>

                        <td style={qcTdStyle}>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: 600,
                              backgroundColor:
                                a.qc_status === 'Completed' ? '#DFF5E1' : '#FFF3D6',
                              color:
                                a.qc_status === 'Completed' ? '#1E7B34' : '#8A6D00',
                            }}
                          >
                            {a.qc_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isAdminModalOpen && selectedAdminSubject && (
        <div style={modalOverlayStyle} onClick={() => setIsAdminModalOpen(false)}>
          <div
            style={{ backgroundColor: '#fff', width: '80%', maxWidth: '90vw', maxHeight: '80vh', borderRadius: '8px', display: 'flex', flexDirection: 'column', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #dee2e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Responses for Subject ID: {selectedAdminSubject.patient_id || selectedAdminSubject.id}</h3>
              <button style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666' }} onClick={() => setIsAdminModalOpen(false)}>&times;</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '10px', borderBottom: '2px solid #dee2e6', backgroundColor: '#f8f9fa' }}>Question</th>
                    <th style={{ textAlign: 'left', padding: '10px', borderBottom: '2px solid #dee2e6', backgroundColor: '#f8f9fa' }}>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAdminSubject.responses && selectedAdminSubject.responses.length > 0 ? (
                    selectedAdminSubject.responses.map((resp) => (
                      <tr key={resp.id}>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee' }}>{resp.question}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee' }}>{resp.answer}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="2" style={{ padding: '10px', borderBottom: '1px solid #eee' }}>No responses found for this session.</td></tr>
                  )}
                </tbody>
              </table>
              {!selectedAdminSubject.assessment && (
                <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 6, backgroundColor: '#f0f4ff', border: '1px solid #c8d8f8', color: '#3a5a9e', fontSize: 13 }}>
                  No assessment has been submitted for this subject yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showConfirm && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <p>
              Create {selectedSubjects.length} stud{selectedSubjects.length === 1 ? 'y' : 'ies'} with the selected user?
            </p>
            <div style={modalActionsStyle}>
              <button style={modalYesStyle} onClick={confirmCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Yes'}
              </button>
              <button
                style={modalNoStyle}
                onClick={() => setShowConfirm(false)}
                disabled={creating}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default QCAdminDashboard;