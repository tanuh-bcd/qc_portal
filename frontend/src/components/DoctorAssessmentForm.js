import React, { useState, useEffect } from 'react';
import ResumableUpload from './ResumableUpload';
import AdditionalDocs from './AdditionalDocs';
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

// Highlights an upload slot with a red border when the file is mandatory and missing
const uploadSlotStyle = (missing) => ({
  borderRadius: 10,
  border: missing ? '2px solid #dc3545' : '2px solid transparent',
  padding: missing ? 6 : 0,
  transition: 'border-color 0.2s',
});

const responsiveGrid = (minColWidth, gap = 16) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(${minColWidth}px, 100%), 1fr))`,
  gap,
});

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

      {/* Composition */}
      <div style={{ ...styles.sectionTitle, fontSize: 13, color: '#555', borderBottom: 'none', marginBottom: 8, marginTop: 4 }}>
        Composition
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <Toggle label="Presence of any masses" checked={data.masses} onChange={(v) => set('masses', v)} disabled={readOnly} />
        {data.masses && (
          <div style={styles.condBox}>
            <div style={styles.row}>
              <div style={styles.field}>
                <label style={styles.label}>Location</label>
                <input disabled={readOnly} style={styles.input} placeholder="e.g. Upper outer quadrant" value={data.mass_location} onChange={(e) => set('mass_location', e.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Description</label>
                <input disabled={readOnly} style={styles.input} placeholder="Size, shape, margins..." value={data.mass_description} onChange={(e) => set('mass_description', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <Toggle label="Presence of calcification" checked={data.calcification} onChange={(v) => set('calcification', v)} disabled={readOnly} />
        {data.calcification && (
          <div style={styles.condBox}>
            <div style={{ display: 'flex', gap: 12 }}>
              <Toggle label="Benign" checked={data.calcification_type === 'benign'} onChange={() => set('calcification_type', 'benign')} disabled={readOnly} />
              <Toggle label="Suspicious" checked={data.calcification_type === 'suspicious'} onChange={() => set('calcification_type', 'suspicious')} disabled={readOnly} />
            </div>
          </div>
        )}
      </div>

      <div style={{ ...styles.sectionTitle, fontSize: 13, color: '#555', borderBottom: 'none', marginBottom: 8 }}>
        Associated Features
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 8, marginBottom: 16 }}>
        <Toggle label="Skin thickening" checked={data.skin_thickening} onChange={(v) => set('skin_thickening', v)} disabled={readOnly} />
        <Toggle label="Nipple retraction" checked={data.nipple_retraction} onChange={(v) => set('nipple_retraction', v)} disabled={readOnly} />
        <Toggle label="Architectural distortion" checked={data.architectural_distortion} onChange={(v) => set('architectural_distortion', v)} disabled={readOnly} />
        <Toggle label="Focal asymmetry" checked={data.focal_asymmetry} onChange={(v) => set('focal_asymmetry', v)} disabled={readOnly} />
        <Toggle label="Asymmetry" checked={data.asymmetry} onChange={(v) => set('asymmetry', v)} disabled={readOnly} />
        <Toggle label="Lymph nodes" checked={data.lymph_nodes} onChange={(v) => set('lymph_nodes', v)} disabled={readOnly} />
      </div>
      {data.lymph_nodes && (
        <div style={{ ...styles.condBox, marginBottom: 16, marginLeft: 0 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Toggle label="Benign" checked={data.lymph_nodes_type === 'benign'} onChange={() => set('lymph_nodes_type', 'benign')} disabled={readOnly} />
            <Toggle label="Malignant" checked={data.lymph_nodes_type === 'malignant'} onChange={() => set('lymph_nodes_type', 'malignant')} disabled={readOnly} />
            <Toggle label="Indeterminate" checked={data.lymph_nodes_type === 'indeterminate'} onChange={() => set('lymph_nodes_type', 'indeterminate')} disabled={readOnly} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <label style={styles.label}>Comments</label>
        <textarea disabled={readOnly} style={{ ...styles.textarea, minHeight: 60 }} value={data.comments || ''} onChange={(e) => set('comments', e.target.value)} placeholder={`Additional comments for ${sideLabel.toLowerCase()} breast...`} />
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
  const [uploadedTypes, setUploadedTypes] = useState({});

  const handleUploadComplete = (fileType, gcsUrl) => {
    setUploadedTypes(prev => ({ ...prev, [fileType]: gcsUrl }));
  };

  const isUploaded = (type) => !!getAttachmentByType(type) || !!uploadedTypes[type];

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (initialData) {
      setFeedback(initialData.questionnaire_feedback || '');
      setQuestionnaireCorrect(initialData.is_questionnaire_correct || false);
      setRecommendation(initialData.recommendation_followup || '');
      setRoutineViews(initialData.routine_views_uploaded || false);
      setDoctorRiskClass(initialData.doctor_risk_class || '');
      setDoctorCaseNotes(initialData.doctor_case_notes || '');
      if (initialData.clinical_findings) {
        const cf = typeof initialData.clinical_findings === 'string'
          ? JSON.parse(initialData.clinical_findings)
          : initialData.clinical_findings;
        if (cf.right) setRightBreast({ ...EMPTY_BREAST, ...cf.right });
        if (cf.left) setLeftBreast({ ...EMPTY_BREAST, ...cf.left });
      }
    }
  }, [initialData]);

  const getAttachmentByType = (type) => {
    if (!initialData || !initialData.attachments) return null;
    return initialData.attachments.find(a => a.file_type === type);
  };

  const getAttachmentsByPrefix = (prefix) => {
    if (!initialData || !initialData.attachments) return [];
    return initialData.attachments.filter(a => a.file_type.startsWith(prefix));
  };

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

    const missingViews = [];
    if (!isUploaded('mammo_cc_left')) missingViews.push('CC Left');
    if (!isUploaded('mammo_cc_right')) missingViews.push('CC Right');
    if (!isUploaded('mammo_mlo_left')) missingViews.push('MLO Left');
    if (!isUploaded('mammo_mlo_right')) missingViews.push('MLO Right');
    const missingReport = !isUploaded('mammo_reading');

    if (missingViews.length > 0 || missingReport) {
      const parts = [];
      if (missingViews.length > 0) parts.push(`Mammography Views (${missingViews.join(', ')})`);
      if (missingReport) parts.push('Mammography Report');
      setToast({ text: `Alert: Please upload ${parts.join(' and ')}.` });
      return;
    }

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
      const response = await fetch(`${apiUrl}/api/v1/patient/assessment`, {
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

  const liveMissingViews = [];
  if (!isUploaded('mammo_cc_left')) liveMissingViews.push('CC Left');
  if (!isUploaded('mammo_cc_right')) liveMissingViews.push('CC Right');
  if (!isUploaded('mammo_mlo_left')) liveMissingViews.push('MLO Left');
  if (!isUploaded('mammo_mlo_right')) liveMissingViews.push('MLO Right');
  const liveMissingReport = !isUploaded('mammo_reading');
  const showMammoAlert = !readOnly && (liveMissingViews.length > 0 || liveMissingReport);

  return (
    <div style={styles.form}>
      <form onSubmit={handleSubmit}>

        {/* Questionnaire Review */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#128203;</span> Questionnaire Review
          </div>
          <div style={styles.cardBody}>
            <Toggle label="Questionnaire responses are correct" checked={questionnaireCorrect} onChange={setQuestionnaireCorrect} disabled={readOnly} />
            <div style={{ marginTop: 12 }}>
              <label style={styles.label}>Feedback (optional)</label>
              <textarea disabled={readOnly} style={styles.textarea} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Any corrections or notes about the questionnaire..." />
            </div>
          </div>
        </div>

        {/* PinkShieldAI Risk Stratification */}
        {snehithaRisk && (
          <div style={styles.card}>
            <div style={{ ...styles.cardHeader, background: 'linear-gradient(135deg, #e91e8c 0%, #c2185b 100%)' }}>
              <span style={styles.cardHeaderIcon}>&#9829;</span> PinkShieldAI Risk Stratification
            </div>
            <div style={{ ...styles.cardBody, textAlign: 'center' }}>
              <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                {RISK_CLASSES.map(rc => {
                  const score = parseFloat(snehithaRisk) / 100;
                  const isActive = (rc.value === 'Baseline Risk' && score < 0.4004) ||
                    (rc.value === 'Evident Risk' && score >= 0.4004 && score < 0.574) ||
                    (rc.value === 'Significant Risk' && score >= 0.574 && score < 0.795) ||
                    (rc.value === 'High Risk' && score >= 0.795);
                  return (
                    <div key={rc.value} style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                      backgroundColor: isActive ? rc.color : '#f0f0f0',
                      color: isActive ? '#111' : '#999',
                      border: isActive ? '2px solid #333' : '1px solid #ddd',
                    }}>{rc.label}</div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Clinician's Clinical Assessment */}
        <div style={styles.card}>
          <div style={{ ...styles.cardHeader, background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
            <span style={styles.cardHeaderIcon}>&#129658;</span> Clinician's Assessment
          </div>
          <div style={styles.cardBody}>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Clinician's Risk Classification</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {RISK_CLASSES.map(rc => (
                  <div key={rc.value} onClick={() => !readOnly && setDoctorRiskClass(rc.value)} style={{
                    ...styles.toggle,
                    ...(doctorRiskClass === rc.value ? { background: rc.color, borderColor: '#333', fontWeight: 600, color: '#111' } : {}),
                    cursor: readOnly ? 'default' : 'pointer', flex: '1 1 120px', justifyContent: 'center', minHeight: 44,
                  }}>
                    {rc.label}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label style={styles.label}>Case Notes (subjective description)</label>
              <textarea
                disabled={readOnly}
                style={{ ...styles.textarea, minHeight: 100 }}
                value={doctorCaseNotes}
                onChange={(e) => setDoctorCaseNotes(e.target.value)}
                placeholder="Describe patient presentation, clinical observations, and overall impression..."
              />
            </div>
          </div>
        </div>

        {/* Mammography Upload — Left on left, Right on right */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#128248;</span> Mammography Views {!readOnly && <span style={{ color: '#ffd6d6', fontSize: 14 }}>*</span>}
            {isUploaded('mammo_cc_right') &&
              isUploaded('mammo_cc_left') &&
              isUploaded('mammo_mlo_right') &&
              isUploaded('mammo_mlo_left') && (
                <span style={{ marginLeft: 'auto', background: '#d4edda', color: '#155724', padding: '4px 12px', borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                  &#10003; All DICOMs uploaded
                </span>
              )}
          </div>
          <div style={styles.cardBody}>
            <div style={responsiveGrid(240, 20)}>
              <div>
                <div style={{ textAlign: 'center', fontWeight: 600, color: '#14868C', marginBottom: 10, fontSize: 14 }}>Left Breast</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={uploadSlotStyle(!readOnly && !isUploaded('mammo_cc_left'))}>
                    <ResumableUpload label="CC Left" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom,image/*" fileType="mammo_cc_left" sessionId={sessionId} existing={getAttachmentByType('mammo_cc_left')} onView={setViewingAttachment} onComplete={handleUploadComplete} readOnly={readOnly} />
                  </div>
                  <div style={uploadSlotStyle(!readOnly && !isUploaded('mammo_mlo_left'))}>
                    <ResumableUpload label="MLO Left" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom,image/*" fileType="mammo_mlo_left" sessionId={sessionId} existing={getAttachmentByType('mammo_mlo_left')} onView={setViewingAttachment} onComplete={handleUploadComplete} readOnly={readOnly} />
                  </div>
                </div>
              </div>
              <div>
                <div style={{ textAlign: 'center', fontWeight: 600, color: '#14868C', marginBottom: 10, fontSize: 14 }}>Right Breast</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={uploadSlotStyle(!readOnly && !isUploaded('mammo_cc_right'))}>
                    <ResumableUpload label="CC Right" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom,image/*" fileType="mammo_cc_right" sessionId={sessionId} existing={getAttachmentByType('mammo_cc_right')} onView={setViewingAttachment} onComplete={handleUploadComplete} readOnly={readOnly} />
                  </div>
                  <div style={uploadSlotStyle(!readOnly && !isUploaded('mammo_mlo_right'))}>
                    <ResumableUpload label="MLO Right" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom,image/*" fileType="mammo_mlo_right" sessionId={sessionId} existing={getAttachmentByType('mammo_mlo_right')} onView={setViewingAttachment} onComplete={handleUploadComplete} readOnly={readOnly} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mammography Alert — shown before Breast Composition if any view/report is missing */}
        {showMammoAlert && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '14px 18px',
            marginBottom: 24,
            borderRadius: 10,
            background: '#fff5f5',
            border: '1.5px solid #f5c2c7',
          }}>
            <span style={{ fontSize: 20, color: '#dc3545', flexShrink: 0 }}>&#9888;</span>
            <div style={{ fontSize: 14, color: '#721c24', fontWeight: 500, lineHeight: 1.5 }}>
              {liveMissingViews.length > 0 && (
                <div>Mammography Views missing: {liveMissingViews.join(', ')}</div>
              )}
              {liveMissingReport && (
                <div>Mammography Report not uploaded.</div>
              )}
            </div>
          </div>
        )}

        {/* Breast Composition — Left on left, Right on right */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#129657;</span> Breast Composition & Findings
          </div>
          <div style={responsiveGrid(320, 0)}>
            <div style={{ ...styles.cardBody, borderRight: '2px solid #e8f4f5', borderBottom: '2px solid #e8f4f5' }}>
              <BreastPanel side="left" data={leftBreast} onChange={setLeftBreast} readOnly={readOnly} />
            </div>
            <div style={{ ...styles.cardBody, borderBottom: '2px solid #e8f4f5' }}>
              <BreastPanel side="right" data={rightBreast} onChange={setRightBreast} readOnly={readOnly} />
            </div>
          </div>
          <div style={{ ...styles.cardBody, borderTop: '2px solid #e8f4f5' }}>
            <label style={styles.label}>Mammography Report {!readOnly && <span style={{ color: '#dc3545' }}>*</span>}</label>
            <div style={uploadSlotStyle(!readOnly && !isUploaded('mammo_reading'))}>
              <ResumableUpload label="Upload Mammography Report" hint=".pdf (up to 25MB)" accept=".pdf,image/*" fileType="mammo_reading" sessionId={sessionId} existing={getAttachmentByType('mammo_reading')} onView={setViewingAttachment} onComplete={handleUploadComplete} readOnly={readOnly} />
            </div>
          </div>
        </div>

        {/* Ultrasound & Biopsy */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#128300;</span> Ultrasound & Biopsy
          </div>
          <div style={styles.cardBody}>
            <div style={responsiveGrid(220, 16)}>
              <ResumableUpload label="Breast Ultrasound (USG Breast)" hint=".dcm / .jpg (up to 100MB)" accept=".dcm,image/*,video/*" fileType="us_video" sessionId={sessionId} existing={getAttachmentByType('us_video')} onView={setViewingAttachment} readOnly={readOnly} />
              <ResumableUpload label="Breast Ultrasound (USG Breast) Report" hint=".pdf (up to 25MB)" accept=".pdf,image/*" fileType="us_reading" sessionId={sessionId} existing={getAttachmentByType('us_reading')} onView={setViewingAttachment} readOnly={readOnly} />
              <ResumableUpload label="Biopsy Report" hint=".pdf (up to 25MB)" accept=".pdf,image/*" fileType="biopsy_reading" sessionId={sessionId} existing={getAttachmentByType('biopsy_reading')} onView={setViewingAttachment} readOnly={readOnly} />
            </div>
          </div>
        </div>

        {/* Annotations */}
        <div style={styles.card}>
          <div style={{ ...styles.cardHeader, background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)' }}>
            <span style={styles.cardHeaderIcon}>&#9998;</span> Mammography Annotations
          </div>
          <div style={styles.cardBody}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>Upload annotated images for each mammography view</div>
            <div style={responsiveGrid(240, 20)}>
              <div>
                <div style={{ textAlign: 'center', fontWeight: 600, color: '#7c3aed', marginBottom: 10, fontSize: 14 }}>Left Breast</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ResumableUpload label="CC Left Annotation" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom" fileType="annot_cc_left" sessionId={sessionId} existing={getAttachmentByType('annot_cc_left')} onView={setViewingAttachment} readOnly={readOnly} />
                  <ResumableUpload label="MLO Left Annotation" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom" fileType="annot_mlo_left" sessionId={sessionId} existing={getAttachmentByType('annot_mlo_left')} onView={setViewingAttachment} readOnly={readOnly} />
                </div>
              </div>
              <div>
                <div style={{ textAlign: 'center', fontWeight: 600, color: '#7c3aed', marginBottom: 10, fontSize: 14 }}>Right Breast</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ResumableUpload label="CC Right Annotation" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom" fileType="annot_cc_right" sessionId={sessionId} existing={getAttachmentByType('annot_cc_right')} onView={setViewingAttachment} readOnly={readOnly} />
                  <ResumableUpload label="MLO Right Annotation" hint=".dcm (up to 100MB)" accept=".dcm,application/dicom" fileType="annot_mlo_right" sessionId={sessionId} existing={getAttachmentByType('annot_mlo_right')} onView={setViewingAttachment} readOnly={readOnly} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Documents */}
        <div style={styles.card}>
          <div style={{ ...styles.cardHeader, background: 'linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%)' }}>
            <span style={styles.cardHeaderIcon}>&#128196;</span> Additional Documents
          </div>
          <div style={styles.cardBody}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>{readOnly ? 'Uploaded documents' : 'Upload whatever is available — none of these are mandatory'}</div>
            <AdditionalDocs
              sessionId={sessionId}
              existingAttachments={getAttachmentsByPrefix('additional_')}
              onView={setViewingAttachment}
              readOnly={readOnly}
            />
          </div>
        </div>

        {/* Recommendation */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardHeaderIcon}>&#128221;</span> Recommendation & Follow-up
          </div>
          <div style={styles.cardBody}>
            <textarea
              disabled={readOnly}
              style={{ ...styles.textarea, minHeight: 100 }}
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              placeholder="Enter recommendation and follow-up plan..."
            />
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

        {!readOnly && (
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.submitBtn,
              opacity: isSubmitting ? 0.7 : 1,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Saving...' : (initialData ? 'Update Assessment' : 'Save Assessment')}
          </button>
        )}
      </form>

      {viewingAttachment && (
        <FileViewer
          attachmentId={viewingAttachment.id}
          fileName={viewingAttachment.file_name}
          mimeType={viewingAttachment.mime_type}
          fileTypeKey={viewingAttachment.file_type}
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