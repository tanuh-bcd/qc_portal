import React, { useState, useEffect } from 'react';
import FileViewer from './FileViewer';

const BIRADS_OPTIONS = [
  { value: '0', label: '0 — Incomplete' },
  { value: '1', label: '1 — Negative' },
  { value: '2', label: '2 — Benign' },
  { value: '3', label: '3 — Probably Benign' },
  { value: '4', label: '4 — Suspicious' },
  { value: '5', label: '5 — Highly Suggestive' },
  { value: '6', label: '6 — Known Malignancy' },
];

const BIRADS_4_SUB = [
  { value: '4A', label: '4A — Low suspicion' },
  { value: '4B', label: '4B — Moderate suspicion' },
  { value: '4C', label: '4C — High suspicion' },
];

const DENSITY_OPTIONS = [
  { value: 'A', label: 'A — Almost entirely fatty' },
  { value: 'B', label: 'B — Scattered fibroglandular' },
  { value: 'C', label: 'C — Heterogeneously dense' },
  { value: 'D', label: 'D — Extremely dense' },
];

const EMPTY_BREAST = {
  masses: false,
  mass_location: '',
  mass_description: '',
  calcification: false,
  calcification_type: '',
  skin_thickening: false,
  nipple_retraction: false,
  lymph_nodes: false,
  lymph_nodes_type: '',
  architectural_distortion: false,
  focal_asymmetry: false,
  asymmetry: false,
  birads: '',
  birads_4_sub: '',
  density: '',
  comments: '',
};

const styles = {
  form: {
    width: '100%',
    margin: '0 auto',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 2px 12px rgba(20,134,140,0.08)',
    border: '1px solid #e8f4f5',
    marginBottom: 24,
    overflow: 'hidden',
  },
  cardHeader: {
    background: 'linear-gradient(135deg, #14868C 0%, #1a9da3 100%)',
    color: '#fff',
    padding: '16px 24px',
    fontSize: 18,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  cardHeaderIcon: {
    fontSize: 22,
    lineHeight: 1,
  },
  cardBody: {
    padding: 'clamp(12px, 4vw, 24px)',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#14868C',
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: '2px solid #e0f2f3',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  row: {
    display: 'flex',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  field: {
    flex: '1 1 0',
    minWidth: 'min(200px, 100%)',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#495057',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #d0d7de',
    fontSize: 14,
    background: '#fafbfc',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #d0d7de',
    fontSize: 14,
    background: '#fafbfc',
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #d0d7de',
    fontSize: 14,
    background: '#fafbfc',
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: 80,
    fontFamily: 'inherit',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fafbfc',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: 14,
    userSelect: 'none',
  },
  toggleActive: {
    background: '#e8f7f8',
    borderColor: '#14868C',
    color: '#14868C',
    fontWeight: 500,
  },
  toggleDot: (active) => ({
    width: 18,
    height: 18,
    borderRadius: 4,
    border: active ? '2px solid #14868C' : '2px solid #ccc',
    background: active ? '#14868C' : '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  }),
  submitBtn: {
    width: '100%',
    padding: '14px 24px',
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
    background: 'linear-gradient(135deg, #14868C 0%, #0e6a6f 100%)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 15px rgba(20,134,140,0.25)',
  },
  condBox: {
    marginLeft: 28,
    marginTop: 8,
    padding: '10px 14px',
    background: '#f8fafa',
    borderLeft: '3px solid #14868C',
    borderRadius: '0 8px 8px 0',
  },
  breastTab: (active) => ({
    flex: 1,
    padding: '12px 0',
    textAlign: 'center',
    fontWeight: 600,
    fontSize: 15,
    cursor: 'pointer',
    borderBottom: active ? '3px solid #14868C' : '3px solid transparent',
    color: active ? '#14868C' : '#888',
    transition: 'all 0.2s',
    background: active ? '#f0fafb' : 'transparent',
  }),
};

const responsiveGrid = (minColWidth, gap = 16) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(${minColWidth}px, 100%), 1fr))`,
  gap,
});

/* ---------------------------------------------------------------
   Read-only file slot.
   Replaces ResumableUpload everywhere in this form: no file input,
   no drag-and-drop, no "Choose File". It only reports whether the
   file exists on the case and offers a View button when it does.
---------------------------------------------------------------- */

const fileSlotStyles = {
  wrap: (has) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 10,
    border: `1px solid ${has ? '#d7ecec' : '#e6e6e6'}`,
    background: has ? '#f6fbfb' : '#fafafa',
    minHeight: 62,
    boxSizing: 'border-box',
  }),
  meta: { minWidth: 0, flex: 1 },
  label: { fontSize: 14, fontWeight: 600, color: '#2c3e50' },
  fileName: {
    fontSize: 12,
    color: '#6b7780',
    marginTop: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: { fontSize: 12, color: '#9aa4ab', marginTop: 3 },
  viewBtn: {
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#14868C',
    background: '#fff',
    border: '1.5px solid #14868C',
    borderRadius: 8,
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  pill: {
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#8a949c',
    background: '#f0f1f2',
    borderRadius: 20,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
};

const FileSlot = ({ label, attachment, onView }) => {
  const has = !!attachment;
  const name = has ? (attachment.qc_file_name ?? attachment.file_name ?? 'Attached file') : null;

  return (
    <div style={fileSlotStyles.wrap(has)}>
      <div style={fileSlotStyles.meta}>
        <div style={fileSlotStyles.label}>{label}</div>
        {has
          ? <div style={fileSlotStyles.fileName} title={name}>{name}</div>
          : <div style={fileSlotStyles.empty}>No file on record</div>}
      </div>
      {has
        ? <button type="button" style={fileSlotStyles.viewBtn} onClick={() => onView(attachment)}>View</button>
        : <span style={fileSlotStyles.pill}>Not uploaded</span>}
    </div>
  );
};

const Toggle = ({ label, checked, onChange, disabled }) => (
  <div
    style={{ ...styles.toggle, ...(checked ? styles.toggleActive : {}), ...(disabled ? { cursor: 'default', opacity: 0.8 } : {}) }}
    onClick={() => !disabled && onChange(!checked)}
  >
    <div style={styles.toggleDot(checked)}>{checked ? '✓' : ''}</div>
    <span>{label}</span>
  </div>
);

const BreastPanel = ({ side, data, onChange, readOnly }) => {
  const set = (key, val) => !readOnly && onChange({ ...data, [key]: val });
  const sideLabel = side === 'right' ? 'Right' : 'Left';

  return (
    <div>
      <div style={{ ...styles.sectionTitle, marginTop: 8 }}>
        {sideLabel} Breast
      </div>

      {/* BIRADS + Density at top (required) */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ ...styles.label, color: '#14868C', fontWeight: 600 }}>BIRADS Category {!readOnly && <span style={{ color: '#dc3545' }}>*</span>}</label>
          <select disabled={readOnly} style={{ ...styles.select, borderColor: !readOnly && !data.birads ? '#dc3545' : '#d0d7de' }} value={data.birads || ''} onChange={(e) => { const v = e.target.value; onChange({ ...data, birads: v, birads_4_sub: v === '4' ? (data.birads_4_sub || '') : '' }); }}>
            <option value="">Select BIRADS</option>
            {BIRADS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {data.birads === '4' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ ...styles.label, color: '#14868C', fontWeight: 600 }}>BIRADS 4 Sub-category {!readOnly && <span style={{ color: '#dc3545' }}>*</span>}</label>
            <select disabled={readOnly} style={styles.select} value={data.birads_4_sub || ''} onChange={(e) => set('birads_4_sub', e.target.value)}>
              <option value="">Select sub-category</option>
              {BIRADS_4_SUB.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ ...styles.label, color: '#14868C', fontWeight: 600 }}>ACR Breast Density {!readOnly && <span style={{ color: '#dc3545' }}>*</span>}</label>
          <select disabled={readOnly} style={{ ...styles.select, borderColor: !readOnly && !data.density ? '#dc3545' : '#d0d7de' }} value={data.density || ''} onChange={(e) => set('density', e.target.value)}>
            <option value="">Select Density</option>
            {DENSITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
};

const RISK_CLASSES = [
  { value: 'Baseline Risk', label: 'Baseline Risk', color: '#6ee7b7' },
  { value: 'Evident Risk', label: 'Evident Risk', color: '#fde047' },
  { value: 'Significant Risk', label: 'Significant Risk', color: '#fb923c' },
  { value: 'High Risk', label: 'High Risk', color: '#fb7185' },
];

const DoctorAssessmentForm = ({ sessionId, initialData, onSaveSuccess, snehithaRisk, readOnly = false }) => {
  const [activeBreast, setActiveBreast] = useState('right');
  const [rightBreast, setRightBreast] = useState({ ...EMPTY_BREAST });
  const [leftBreast, setLeftBreast] = useState({ ...EMPTY_BREAST });
  const [routineViews, setRoutineViews] = useState(false);
  const [recommendation, setRecommendation] = useState('');
  const [feedback, setFeedback] = useState('');
  const [questionnaireCorrect, setQuestionnaireCorrect] = useState(false);
  const [doctorRiskClass, setDoctorRiskClass] = useState('');
  const [doctorCaseNotes, setDoctorCaseNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [viewingAttachment, setViewingAttachment] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (initialData) {
      setFeedback(initialData.qc_questionnaire_feedback || '');
      setQuestionnaireCorrect(initialData.qc_is_questionnaire_correct || false);
      setRecommendation(initialData.qc_recommendation_followup || '');
      setRoutineViews(initialData.qc_routine_views_uploaded || false);
      setDoctorRiskClass(initialData.qc_doctor_risk_class || '');
      setDoctorCaseNotes(initialData.qc_doctor_case_notes || '');
      if (initialData.qc_clinical_findings) {
        const cf = typeof initialData.qc_clinical_findings === 'string'
          ? JSON.parse(initialData.qc_clinical_findings)
          : initialData.qc_clinical_findings;
        if (cf.right) setRightBreast({ ...EMPTY_BREAST, ...cf.right });
        if (cf.left) setLeftBreast({ ...EMPTY_BREAST, ...cf.left });
      }
    }
  }, [initialData]);

  const getAttachmentByType = (type) => {
    if (!initialData || !initialData.attachments) return null;
    return initialData.attachments.find(a => a.qc_file_type === type);
  };

  const getAttachmentsByPrefix = (prefix) => {
    if (!initialData || !initialData.attachments) return [];
    return initialData.attachments.filter(a => a.qc_file_type.startsWith(prefix));
  };

  // Files are read-only now, so presence is decided purely by what is on the case.
  const isUploaded = (type) => !!getAttachmentByType(type);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const missing = [];
    if (!rightBreast.birads) missing.push('Right Breast BIRADS');
    if (!rightBreast.density) missing.push('Right Breast Density');
    if (!leftBreast.birads) missing.push('Left Breast BIRADS');
    if (!leftBreast.density) missing.push('Left Breast Density');

    if (missing.length > 0) {
      setToast({ text: `Please fill required fields: ${missing.join(', ')}` });
      return;
    }

    // NOTE: the mammography upload gate was removed along with the upload
    // controls — the reader cannot attach files from this screen, so blocking
    // submission on a missing file would leave the case unfinishable.

    setIsSubmitting(true);
    setMessage({ type: '', text: '' });

    const clinicalFindings = JSON.stringify({ right: rightBreast, left: leftBreast });

    const submitData = new FormData();
    submitData.append('patient_session_id', sessionId);
    submitData.append('questionnaire_feedback', feedback);
    submitData.append('is_questionnaire_correct', questionnaireCorrect);
    submitData.append('mammo_birads', rightBreast.birads || '');
    submitData.append('mammo_density', rightBreast.density || '');
    submitData.append('us_biopsy_birads', leftBreast.birads || '');
    submitData.append('us_biopsy_density', leftBreast.density || '');
    submitData.append('clinical_findings', clinicalFindings);
    submitData.append('recommendation_followup', recommendation);
    submitData.append('routine_views_uploaded', routineViews);
    submitData.append('precision_diagnosis', '');
    submitData.append('datapoint_feedback', '');
    submitData.append('doctor_risk_class', doctorRiskClass);
    submitData.append('doctor_case_notes', doctorCaseNotes);

    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/qc/patient/assessment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: submitData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.upload_warnings && data.upload_warnings.length > 0) {
          setMessage({ type: 'warning', text: `Assessment saved. Some files failed to upload: ${data.upload_warnings.join('; ')}` });
        } else {
          setMessage({ type: 'success', text: 'Assessment saved successfully!' });
        }
        if (onSaveSuccess) onSaveSuccess();
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: `Failed: ${errorData.detail || 'Unknown error'}` });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'An error occurred while saving.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Informational only — nothing on this screen can fix a missing file.
  const missingViews = [];
  if (!isUploaded('mammo_cc_left')) missingViews.push('CC Left');
  if (!isUploaded('mammo_cc_right')) missingViews.push('CC Right');
  if (!isUploaded('mammo_mlo_left')) missingViews.push('MLO Left');
  if (!isUploaded('mammo_mlo_right')) missingViews.push('MLO Right');
  const missingReport = !isUploaded('mammo_reading');
  const showMammoNotice = missingViews.length > 0 || missingReport;

  const allViewsPresent =
    isUploaded('mammo_cc_right') &&
    isUploaded('mammo_cc_left') &&
    isUploaded('mammo_mlo_right') &&
    isUploaded('mammo_mlo_left');

  return (
    <div style={styles.form}>
      <form onSubmit={handleSubmit}>
        {/* Missing-file notice — states what is absent, no upload prompt */}
        {showMammoNotice && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '14px 18px',
            marginBottom: 24,
            borderRadius: 10,
            background: '#fffaf0',
            border: '1.5px solid #f0dca8',
          }}>
            <span style={{ fontSize: 20, color: '#b0691c', flexShrink: 0 }}>&#9888;</span>
            <div style={{ fontSize: 14, color: '#7a5c0a', fontWeight: 500, lineHeight: 1.5 }}>
              {missingViews.length > 0 && (
                <div>Mammography views not on this case: {missingViews.join(', ')}</div>
              )}
              {missingReport && (
                <div>Mammography report not uploaded on this case.</div>
              )}
            </div>
          </div>
        )}

        {/* Breast Composition — Left on left, Right on right */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#129657;</span> Breast Composition &amp; Findings
          </div>

          <div style={responsiveGrid(320, 0)}>
            <div
              style={{
                ...styles.cardBody,
                borderRight: '2px solid #e8f4f5',
                borderBottom: '2px solid #e8f4f5',
              }}
            >
              <BreastPanel
                side="left"
                data={leftBreast}
                readOnly={true}
              />
            </div>

            <div
              style={{
                ...styles.cardBody,
                borderBottom: '2px solid #e8f4f5',
              }}
            >
              <BreastPanel
                side="right"
                data={rightBreast}
                readOnly={true}
              />
            </div>
          </div>

          <div style={{ ...styles.cardBody, borderTop: '2px solid #e8f4f5' }}>
            <label style={styles.label}>Mammography Report</label>

            <FileSlot
              label="Mammography Report"
              attachment={getAttachmentByType('mammo_reading')}
              onView={setViewingAttachment}
              readOnly={true}
            />
          </div>
        </div>

        {/* Ultrasound & Biopsy — read-only */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#128300;</span> Ultrasound &amp; Biopsy
          </div>
          <div style={styles.cardBody}>
            <div style={responsiveGrid(220, 16)}>
              <FileSlot label="Breast Ultrasound (USG Breast)" attachment={getAttachmentByType('us_video')} onView={setViewingAttachment} />
              <FileSlot label="Breast Ultrasound (USG Breast) Report" attachment={getAttachmentByType('us_reading')} onView={setViewingAttachment} />
              <FileSlot label="Biopsy Report" attachment={getAttachmentByType('biopsy_reading')} onView={setViewingAttachment} />
            </div>
          </div>
        </div>

        {/* Messages */}
        {message.text && (
          <div style={{
            padding: 14,
            marginBottom: 16,
            borderRadius: 10,
            backgroundColor: message.type === 'success' ? '#d4edda' : message.type === 'warning' ? '#fff3cd' : '#f8d7da',
            color: message.type === 'success' ? '#155724' : message.type === 'warning' ? '#856404' : '#721c24',
            border: `1px solid ${message.type === 'success' ? '#c3e6cb' : message.type === 'warning' ? '#ffc107' : '#f5c6cb'}`,
            fontWeight: 500,
          }}>
            {message.text}
          </div>
        )}
      </form>

      {viewingAttachment && (
        <FileViewer
          attachmentId={viewingAttachment.qc_id ?? viewingAttachment.id}
          fileName={viewingAttachment.qc_file_name ?? viewingAttachment.file_name}
          mimeType={viewingAttachment.qc_mime_type ?? viewingAttachment.mime_type}
          fileTypeKey={viewingAttachment.qc_file_type ?? viewingAttachment.file_type}
          onClose={() => setViewingAttachment(null)}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 2000,
          background: '#fff',
          borderLeft: '5px solid #dc3545',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: '16px 20px',
          minWidth: 280,
          maxWidth: 420,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <span style={{ fontSize: 20, color: '#dc3545', flexShrink: 0 }}>&#9888;</span>
          <div style={{ flex: 1, fontSize: 14, color: '#721c24', fontWeight: 500, lineHeight: 1.4 }}>
            {toast.text}
          </div>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'none', border: 'none', fontSize: 18, color: '#999', cursor: 'pointer', lineHeight: 1, padding: 0 }}
          >&times;</button>
        </div>
      )}
    </div>
  );
};

export default DoctorAssessmentForm;