import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import useAttachmentImage from '../hooks/useAttachmentImage';
import { BIRADS_OPTIONS, BIRADS_4_SUB, DENSITY_OPTIONS } from './DoctorAssessmentForm';

// The four mammography DICOM views this workflow reviews — mirrors
// REVIEWABLE_VIEW_TYPES in backend/src/api/radiologist.py and the VIEW_TYPES
// convention BreastCaseReviewPanel.jsx already established. Only whichever of
// these actually have an attachment on a given case are shown/required.
const VIEW_TYPES = [
  { key: 'mammo_cc_left', proj: 'CC', side: 'Left' },
  { key: 'mammo_mlo_left', proj: 'MLO', side: 'Left' },
  { key: 'mammo_cc_right', proj: 'CC', side: 'Right' },
  { key: 'mammo_mlo_right', proj: 'MLO', side: 'Right' },
];

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const GRADES = ['Best', 'Good', 'Bad', 'Not a Mammogram'];
const REASON_REQUIRED_GRADES = ['Bad', 'Not a Mammogram'];
const EMPTY_SIDE = { birads: '', birads_4_sub: '', density: '' };

const fmtBytes = (bytes) => {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const apiUrl = process.env.REACT_APP_API_URL || '';
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

async function apiPost(path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error((data && data.detail) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchSessionDetail(sessionId) {
  const res = await fetch(`${apiUrl}/api/v1/qc/doctor/sessions/${sessionId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load case (${res.status})`);
  return res.json();
}

const DicomCaseViewer = ({ initialCaseItem, initialSessionDetail, assignedCases = [], onClose }) => {
  const [currentCase, setCurrentCase] = useState(initialCaseItem);
  const [currentSession, setCurrentSession] = useState(initialSessionDetail);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [reviews, setReviews] = useState({});
  const [leftFindings, setLeftFindings] = useState({ ...EMPTY_SIDE });
  const [rightFindings, setRightFindings] = useState({ ...EMPTY_SIDE });
  const [caseNotes, setCaseNotes] = useState('');
  const [grade, setGrade] = useState('');
  const [reason, setReason] = useState('');
  const [zoomIdx, setZoomIdx] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saving, setSaving] = useState(false);
  const [loadingCase, setLoadingCase] = useState(false);
  const [error, setError] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [allCasesReviewed, setAllCasesReviewed] = useState(false);

  const zoom = ZOOM_STEPS[zoomIdx];

  const images = useMemo(() => {
    const attachments = (currentSession && currentSession.assessment && currentSession.assessment.attachments) || [];
    return VIEW_TYPES
      .map(v => ({ ...v, attachment: attachments.find(a => a.qc_file_type === v.key) }))
      .filter(v => !!v.attachment);
  }, [currentSession]);

  const currentImage = images[currentImageIndex];
  const { canvasRef, status: imageStatus, blobUrl, meta } = useAttachmentImage(currentImage && currentImage.attachment);

  // Rehydrate everything (reviews, findings, notes) whenever a new case loads.
  useEffect(() => {
    if (!currentSession || !currentSession.assessment) return;
    const assessment = currentSession.assessment;
    let feedback = {};
    try {
      feedback = assessment.qc_datapoint_feedback ? JSON.parse(assessment.qc_datapoint_feedback) : {};
    } catch {
      feedback = {};
    }
    setReviews(feedback.image_reviews || {});

    let clinicalFindings = {};
    if (assessment.qc_clinical_findings) {
      clinicalFindings = typeof assessment.qc_clinical_findings === 'string'
        ? JSON.parse(assessment.qc_clinical_findings)
        : assessment.qc_clinical_findings;
    }
    setLeftFindings({ ...EMPTY_SIDE, ...(clinicalFindings.left || {}) });
    setRightFindings({ ...EMPTY_SIDE, ...(clinicalFindings.right || {}) });
    setCaseNotes(assessment.qc_doctor_case_notes || '');
    setCurrentImageIndex(0);
    setZoomIdx(0);
    setError(null);
    setValidationError(null);
  }, [currentSession]);

  // Rehydrate the grade/reason panel whenever the visible image changes —
  // pulling from what's already saved for it, if anything.
  useEffect(() => {
    if (!currentImage) { setGrade(''); setReason(''); return; }
    const saved = reviews[String(currentImage.attachment.qc_id)];
    setGrade(saved ? saved.grade : '');
    setReason(saved ? (saved.reason || '') : '');
    setZoomIdx(0);
    setValidationError(null);
    // Deliberately keyed only on navigation/case-change, not on `reviews` or
    // `images` (both derive from currentSession) — re-running this on every
    // review save would reset zoom/scroll position for no reason.
  }, [currentImageIndex, currentSession]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [saving, onClose]);

  const buildFindingsPayload = () => ({
    left: { birads: leftFindings.birads || null, birads_4_sub: leftFindings.birads_4_sub || null, density: leftFindings.density || null },
    right: { birads: rightFindings.birads || null, birads_4_sub: rightFindings.birads_4_sub || null, density: rightFindings.density || null },
    case_notes: caseNotes,
  });

  // Saves the current image's grade/reason (plus BIRADS/Density/notes).
  // Returns the API response on success, or null on validation/save failure.
  // Validation/save/complete failures are toasted (not just shown inline in
  // the review panel) because the panel — and its inline error box — is
  // hidden along with everything else when "Hide Details" is on. Without
  // this, clicking Next Image while hidden fails validation with no visible
  // feedback at all. Failing validation also re-shows the panel, since the
  // reviewer has no way to pick a grade while it's hidden.
  const saveCurrentReview = async () => {
    setValidationError(null);
    setError(null);
    if (!grade) {
      const msg = 'Please select an image grade before proceeding.';
      setValidationError(msg);
      setShowInfo(true);
      toast.error(msg);
      return null;
    }
    if (REASON_REQUIRED_GRADES.includes(grade) && !reason.trim()) {
      const msg = 'Please enter a reason before proceeding.';
      setValidationError(msg);
      setShowInfo(true);
      toast.error(msg);
      return null;
    }
    setSaving(true);
    try {
      const response = await apiPost(
        `/api/v1/qc/radiologist/cases/${currentCase.case_id}/images/${currentImage.attachment.qc_id}/review`,
        { grade, reason: reason.trim() || null, ...buildFindingsPayload() },
      );
      setReviews(prev => ({ ...prev, [String(currentImage.attachment.qc_id)]: { grade, reason: reason.trim() || null } }));
      return response;
    } catch (err) {
      setError('Unable to save review. Please try again.');
      toast.error('Unable to save review. Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Loads a different case into the viewer in place — used both when the
  // complete-case API hands back the next assigned case, and when browsing
  // between cases directly (e.g. "Next Case" while reviewing a Completed one).
  const goToCase = async (caseItem) => {
    setLoadingCase(true);
    try {
      const session = await fetchSessionDetail(caseItem.session_id);
      setCurrentCase(caseItem);
      setCurrentSession(session);
    } catch (err) {
      toast.error('Unable to load that case. Please try again.');
    } finally {
      setLoadingCase(false);
    }
  };

  const handleCompleteCase = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiPost(`/api/v1/qc/radiologist/cases/${currentCase.case_id}/complete`, {});
      if (response.next_case) {
        await goToCase(response.next_case);
      } else {
        setAllCasesReviewed(true);
      }
    } catch (err) {
      setError('Unable to complete case. Please try again.');
      toast.error('Unable to complete case. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOnly = async () => {
    const response = await saveCurrentReview();
    if (response && response.all_images_reviewed) await handleCompleteCase();
  };

  const handleNext = async () => {
    const response = await saveCurrentReview();
    if (!response) return;
    if (response.all_images_reviewed) {
      await handleCompleteCase();
    } else if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(i => i + 1);
    }
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0) setCurrentImageIndex(i => i - 1);
  };

  // A Completed case is opened to review what was already submitted, not to
  // re-grade it — navigation just pages through the saved images/grades
  // instead of re-validating and re-saving (which would also re-fire the
  // complete-case call on every visit to the last image).
  const handleNextView = () => {
    if (currentImageIndex < images.length - 1) setCurrentImageIndex(i => i + 1);
  };

  const isLastImage = currentImageIndex === images.length - 1;
  const isCompleted = currentCase.status === 'Completed';
  // Per-image, independent of overall case status — a case can be only
  // partway reviewed, and each already-graded image should still show as
  // submitted when you page back to it.
  const isCurrentImageSubmitted = !!(currentImage && reviews[String(currentImage.attachment.qc_id)]);

  // Case-level position within the radiologist's own assigned-cases queue —
  // lets a Completed (read-only) case still offer "Next/Previous Case"
  // instead of being a dead end that forces a trip back to the dashboard.
  const caseIndexInQueue = assignedCases.findIndex(c => c.case_id === currentCase.case_id);
  const nextCaseInQueue = caseIndexInQueue >= 0 ? assignedCases[caseIndexInQueue + 1] : null;
  const previousCaseInQueue = caseIndexInQueue > 0 ? assignedCases[caseIndexInQueue - 1] : null;

  if (allCasesReviewed) {
    return (
      <div style={styles.overlay}>
        <div style={styles.completionCard}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>&#10003;</div>
          <h2 style={{ margin: '0 0 8px' }}>All assigned cases have been reviewed.</h2>
          <button style={styles.primaryBtn} onClick={onClose}>Return to Radiologist Dashboard</button>
        </div>
      </div>
    );
  }

  if (loadingCase || !currentCase || !currentSession) {
    return (
      <div style={styles.overlay}>
        <div style={{ color: '#cfd6d8', fontSize: 14 }}>Loading next case…</div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div style={styles.overlay}>
        <div style={styles.completionCard}>
          <h2 style={{ margin: '0 0 8px' }}>No images available on this case.</h2>
          <p style={{ color: '#8a949c' }}>QC ID: {currentCase.qc_subject_id}</p>
          <button style={styles.primaryBtn} onClick={onClose}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <button style={styles.backBtn} onClick={onClose}>&#8592; Back to cases</button>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#eee' }}>Case {currentCase.qc_subject_id}</div>
          {isCompleted && <span style={styles.completedBadge}>Completed</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={styles.navBtn(currentImageIndex === 0)} disabled={currentImageIndex === 0} onClick={handlePrevious}>
            &#8592; Previous Image
          </button>
          <span style={{ fontSize: 13, color: '#cfd6d8', minWidth: 100, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            Image {currentImageIndex + 1} of {images.length}
            {isCurrentImageSubmitted && <span style={styles.submittedDot} title="Already submitted">&#10003;</span>}
          </span>
          {isCompleted ? (
            <button style={styles.navBtn(isLastImage)} disabled={isLastImage} onClick={handleNextView}>
              Next Image →
            </button>
          ) : (
            <button style={styles.navBtn(false)} disabled={saving} onClick={handleNext}>
              {isLastImage ? 'Complete Case & Next Case' : 'Next Image →'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={styles.zoomBtn(zoomIdx === 0)} disabled={zoomIdx === 0} onClick={() => setZoomIdx(i => Math.max(0, i - 1))}>&minus;</button>
          <span style={{ fontSize: 12.5, minWidth: 40, textAlign: 'center', color: '#cfd6d8' }}>{zoom}&times;</span>
          <button style={styles.zoomBtn(zoomIdx === ZOOM_STEPS.length - 1)} disabled={zoomIdx === ZOOM_STEPS.length - 1} onClick={() => setZoomIdx(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}>+</button>
          <button style={styles.infoBtn(showInfo)} onClick={() => setShowInfo(v => !v)}>{showInfo ? 'Hide Details' : 'Show Details'}</button>
        </div>
      </div>

      <div style={styles.body}>
        <div style={styles.viewerArea}>
          {/* The canvas stays mounted at this same spot across every status —
              conditionally swapping in a *different* <canvas> element once
              status flips to 'canvas' would hand the ref to a fresh, blank
              DOM node instead of the one useAttachmentImage already decoded
              pixels onto, leaving the visible canvas empty. Only its
              visibility toggles. */}
          <div style={styles.imageScroll}>
            {imageStatus === 'loading' && <div style={styles.centerMsg}>Loading image…</div>}
            {imageStatus === 'error' && <div style={styles.centerMsg}>Unable to load image. Please try again.</div>}
            {imageStatus === 'img' && (
              <img
                src={blobUrl}
                alt={`${currentImage.proj} ${currentImage.side}`}
                style={mediaStyle(zoom, brightness, contrast)}
              />
            )}
            <canvas
              ref={canvasRef}
              style={{ ...mediaStyle(zoom, brightness, contrast), display: imageStatus === 'canvas' ? 'block' : 'none' }}
            />
          </div>

          {showInfo && (
            <div style={styles.metaPanel}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{currentImage.proj} — {currentImage.side}</div>
              <MetaRow label="Case ID" value={currentCase.qc_subject_id} />
              <MetaRow label="Image file" value={currentImage.attachment.qc_file_name} />
              <MetaRow label="File type" value={currentImage.key} />
              <MetaRow label="Format" value={meta ? meta.format : '—'} />
              <MetaRow label="Dimensions" value={meta && meta.cols && meta.rows ? `${meta.cols} × ${meta.rows}` : '—'} />
              <MetaRow label="Bit depth" value={meta && meta.bitsAllocated ? `${meta.bitsAllocated}-bit` : '—'} />
              <MetaRow label="Compression" value={meta ? (meta.compressed ? 'Compressed' : 'Uncompressed') : '—'} />
              <MetaRow label="File size" value={meta ? fmtBytes(meta.fileSizeBytes) : '—'} />
            </div>
          )}

          <div style={styles.adjustPanel}>
            <div style={styles.adjustRow}>
              <label style={styles.adjustLabel}>Window Level</label>
              <input type="range" min="40" max="160" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
            </div>
            <div style={styles.adjustRow}>
              <label style={styles.adjustLabel}>Window Width</label>
              <input type="range" min="40" max="200" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
            </div>
            <button style={styles.resetBtn} onClick={() => { setZoomIdx(0); setBrightness(100); setContrast(100); }}>Reset View</button>
          </div>
        </div>

        {showInfo && (
          <div style={styles.reviewPanel}>
            <div style={styles.panelSection}>
              <div style={styles.panelTitle}>Image Review{isCurrentImageSubmitted ? ' (submitted)' : ''}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {GRADES.map(g => (
                  <label key={g} style={styles.radioRow(grade === g)}>
                    <input
                      type="radio"
                      name="grade"
                      checked={grade === g}
                      disabled={isCompleted}
                      onChange={() => { setGrade(g); setValidationError(null); }}
                    />
                    {g}
                  </label>
                ))}
              </div>
              {REASON_REQUIRED_GRADES.includes(grade) && (
                <div style={{ marginTop: 10 }}>
                  <label style={styles.smallLabel}>Reason / Comment *</label>
                  <textarea
                    style={styles.textarea}
                    value={reason}
                    disabled={isCompleted}
                    onChange={(e) => { setReason(e.target.value); setValidationError(null); }}
                    placeholder="Describe the issue with this image..."
                  />
                </div>
              )}
              {validationError && <div style={styles.errorText}>{validationError}</div>}
            </div>

            <div style={styles.panelSection}>
              <div style={styles.panelTitle}>Additional Clinical Information</div>
              <BreastFindingsFields label="Left Breast" data={leftFindings} readOnly />
              <BreastFindingsFields label="Right Breast" data={rightFindings} readOnly />
              <div style={{ marginTop: 10 }}>
                <label style={styles.smallLabel}>Notes / Comments</label>
                <textarea
                  style={styles.textarea}
                  value={caseNotes}
                  disabled={isCompleted}
                  onChange={(e) => setCaseNotes(e.target.value)}
                  placeholder="Case notes..."
                />
              </div>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}

            {isCompleted ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={styles.completedNote}>This case has been completed. Review details are read-only.</div>
                <div style={styles.panelActions}>
                  <button
                    style={styles.secondaryBtn}
                    disabled={loadingCase || !previousCaseInQueue}
                    onClick={() => goToCase(previousCaseInQueue)}
                  >
                    ← Previous Case
                  </button>
                  <button
                    style={styles.primaryBtn}
                    disabled={loadingCase || !nextCaseInQueue}
                    onClick={() => goToCase(nextCaseInQueue)}
                  >
                    Next Case →
                  </button>
                </div>
              </div>
            ) : (
              <div style={styles.panelActions}>
                <button style={styles.secondaryBtn} disabled={saving} onClick={handleSaveOnly}>
                  {saving ? 'Saving…' : 'Save Review'}
                </button>
                <button style={styles.primaryBtn} disabled={saving} onClick={handleNext}>
                  {saving ? 'Saving…' : isLastImage ? 'Complete Case' : 'Next Image →'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const MetaRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11.5, padding: '2px 0' }}>
    <span style={{ color: '#98a3a5' }}>{label}</span>
    <span style={{ color: '#f0f2f2', fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{value}</span>
  </div>
);

// Read-only in this panel — BIRADS/Density are recorded elsewhere in the QC
// workflow; this view is for reference while grading images, not editing.
const BreastFindingsFields = ({ label, data, readOnly }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#14868C', marginBottom: 6 }}>{label}</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 120px' }}>
        <label style={styles.smallLabel}>BIRADS</label>
        <select style={styles.select(readOnly)} value={data.birads || ''} disabled={readOnly} onChange={() => {}}>
          <option value="">Select</option>
          {BIRADS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {data.birads === '4' && (
        <div style={{ flex: '1 1 140px' }}>
          <label style={styles.smallLabel}>BIRADS 4 Sub</label>
          <select style={styles.select(readOnly)} value={data.birads_4_sub || ''} disabled={readOnly} onChange={() => {}}>
            <option value="">Select</option>
            {BIRADS_4_SUB.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      <div style={{ flex: '1 1 120px' }}>
        <label style={styles.smallLabel}>Density</label>
        <select style={styles.select(readOnly)} value={data.density || ''} disabled={readOnly} onChange={() => {}}>
          <option value="">Select</option>
          {DENSITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  </div>
);

const mediaStyle = (zoom, brightness, contrast) => ({
  width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
  maxWidth: zoom === 1 ? '100%' : 'none',
  maxHeight: zoom === 1 ? '100%' : 'none',
  height: 'auto',
  objectFit: 'contain',
  imageRendering: 'pixelated',
  margin: 'auto',
  display: 'block',
  filter: `brightness(${brightness}%) contrast(${contrast}%)`,
});

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0d0d0d',
    zIndex: 3000, display: 'flex', flexDirection: 'column',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  header: {
    flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 14, flexWrap: 'wrap', padding: '10px clamp(12px, 3vw, 24px)',
    borderBottom: '1px solid #262626', color: '#e8eaea',
  },
  backBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid #4a5a5b', background: '#14868C',
    color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  navBtn: (disabled) => ({
    padding: '8px 14px', borderRadius: 8, border: '1px solid #3a4444',
    background: disabled ? '#161616' : '#1b1b1b', color: disabled ? '#555' : '#e8eaea',
    fontWeight: 600, fontSize: 13, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  }),
  zoomBtn: (disabled) => ({
    minWidth: 32, padding: '6px 10px', borderRadius: 6, border: '1px solid #3a4444',
    background: '#1b1b1b', color: disabled ? '#555' : '#e8eaea', fontWeight: 600, fontSize: 14,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }),
  infoBtn: (on) => ({
    padding: '6px 12px', borderRadius: 6, border: '1px solid #3a4444',
    background: on ? '#243030' : '#1b1b1b', color: on ? '#e8eaea' : '#8a949c',
    fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  }),
  body: { flex: 1, display: 'flex', minHeight: 0 },
  viewerArea: { flex: 1, position: 'relative', background: '#000', display: 'flex', minWidth: 0 },
  imageScroll: { flex: 1, overflow: 'auto', display: 'flex' },
  centerMsg: { margin: 'auto', color: '#cfd6d8', fontSize: 14 },
  metaPanel: {
    position: 'absolute', top: 14, right: 14, zIndex: 3,
    minWidth: 200, padding: '10px 12px', borderRadius: 8,
    background: 'rgba(12,12,12,0.78)', border: '1px solid rgba(255,255,255,0.16)',
  },
  adjustPanel: {
    position: 'absolute', bottom: 14, left: 14, zIndex: 3,
    minWidth: 220, padding: '10px 12px', borderRadius: 8,
    background: 'rgba(12,12,12,0.78)', border: '1px solid rgba(255,255,255,0.16)',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  adjustRow: { display: 'flex', alignItems: 'center', gap: 8 },
  adjustLabel: { fontSize: 11, color: '#cfd6d8', minWidth: 90 },
  resetBtn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid #3a4444', background: '#1b1b1b',
    color: '#e8eaea', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  reviewPanel: {
    width: 340, flexShrink: 0, background: '#161a1a', borderLeft: '1px solid #262626',
    padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
  },
  panelSection: { background: '#1d2222', borderRadius: 10, padding: 14 },
  panelTitle: { fontSize: 13, fontWeight: 700, color: '#e8eaea', marginBottom: 10 },
  radioRow: (checked) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6,
    fontSize: 13, color: checked ? '#e8eaea' : '#b6bfc0', background: checked ? '#243030' : 'transparent',
    cursor: 'pointer', fontWeight: checked ? 600 : 400,
  }),
  smallLabel: { display: 'block', fontSize: 11.5, color: '#98a3a5', marginBottom: 4, fontWeight: 600 },
  textarea: {
    width: '100%', minHeight: 60, padding: '8px 10px', borderRadius: 6, border: '1px solid #3a4444',
    background: '#121515', color: '#e8eaea', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
  },
  select: (disabled) => ({
    width: '100%', padding: '7px 8px', borderRadius: 6, border: '1px solid #3a4444',
    background: disabled ? '#1a1d1d' : '#121515', color: disabled ? '#8a949c' : '#e8eaea',
    fontSize: 12, boxSizing: 'border-box', cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  errorText: { color: '#e57373', fontSize: 12, marginTop: 8, fontWeight: 600 },
  errorBanner: {
    padding: '10px 12px', borderRadius: 8, background: '#3a1f1f', border: '1px solid #5c2c2c',
    color: '#f0b4b4', fontSize: 12.5, fontWeight: 500,
  },
  panelActions: { display: 'flex', gap: 10, marginTop: 'auto' },
  completedBadge: {
    padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700,
    backgroundColor: '#1d3a2d', color: '#6ee7b7',
  },
  submittedDot: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: '50%', background: '#1d3a2d',
    color: '#6ee7b7', fontSize: 10, fontWeight: 700, lineHeight: 1,
  },
  completedNote: {
    marginTop: 'auto', padding: '10px 12px', borderRadius: 8, background: '#1d3a2d',
    color: '#8fd8b1', fontSize: 12.5, fontWeight: 500, textAlign: 'center',
  },
  primaryBtn: {
    flex: 1, padding: '11px 14px', borderRadius: 8, border: 'none', background: '#14868C',
    color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  secondaryBtn: {
    flex: 1, padding: '11px 14px', borderRadius: 8, border: '1px solid #3a4444', background: '#1b1b1b',
    color: '#e8eaea', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  completionCard: {
    margin: 'auto', textAlign: 'center', color: '#e8eaea', background: '#1d2222',
    borderRadius: 16, padding: '40px 48px', maxWidth: 420,
  },
};

export default DicomCaseViewer;
