import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import './CaseViewer.css';
import useAttachmentImage from '../hooks/useAttachmentImage';
import useAttachmentFile from '../hooks/useAttachmentFile';
import { BIRADS_OPTIONS, BIRADS_4_SUB, DENSITY_OPTIONS } from './DoctorAssessmentForm';
import { VIEW_TYPES, ZOOM_STEPS, GRADES, REASON_REQUIRED_GRADES, EMPTY_SIDE, fmtBytes } from '../constants/caseReviewItems';
import { apiPost, fetchSessionDetail } from '../utils/caseReviewApi';

const DicomCaseViewer = ({ initialCaseItem, initialSessionDetail, assignedCases = [], onClose, readOnly = false }) => {
  const [currentCase, setCurrentCase] = useState(initialCaseItem);
  const [currentSession, setCurrentSession] = useState(initialSessionDetail);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
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
  const isReportItem = !!(currentImage && currentImage.isReport);
  const { canvasRef, status: imageStatus, blobUrl, meta: dicomMeta } = useAttachmentImage(
    currentImage && !isReportItem ? currentImage.attachment : null
  );
  const { status: reportStatus, blobUrl: reportBlobUrl, docxHtml, meta: reportMeta } = useAttachmentFile(
    currentImage && isReportItem ? currentImage.attachment : null
  );
  const meta = isReportItem ? reportMeta : dicomMeta;
  const imageLabel = currentImage ? (currentImage.side ? `${currentImage.proj} — ${currentImage.side}` : currentImage.proj) : '';
  const isLastImage = currentImageIndex === images.length - 1;
  const isCompleted = currentCase.status === 'Completed';
  const locked = readOnly || isCompleted;
  const hasSubmittedGrade = locked && !!grade;

  // Rehydrate everything (combined review, findings, notes) whenever a new case loads.
  useEffect(() => {
    if (!currentSession || !currentSession.assessment) return;
    const assessment = currentSession.assessment;
    let feedback = {};
    try {
      feedback = assessment.qc_datapoint_feedback ? JSON.parse(assessment.qc_datapoint_feedback) : {};
    } catch {
      feedback = {};
    }
    const caseReview = feedback.case_review || {};
    let effectiveGrade = caseReview.grade || '';
    let effectiveReason = caseReview.reason || '';
    if (!effectiveGrade && feedback.image_reviews) {
      const legacyReviews = Object.values(feedback.image_reviews).filter(Boolean);
      const worst = legacyReviews.reduce((acc, r) => {
        const idx = GRADES.indexOf(r.grade);
        return idx > acc.idx ? { idx, review: r } : acc;
      }, { idx: -1, review: null });
      if (worst.review) {
        effectiveGrade = worst.review.grade || '';
        effectiveReason = legacyReviews.map(r => r.reason).filter(Boolean).join('; ');
      }
    }
    setGrade(effectiveGrade);
    setReason(effectiveReason);

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

  useEffect(() => {
    setZoomIdx(0);
  }, [currentImageIndex]);

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

  const goToCase = async (caseItem) => {
    setLoadingCase(true);
    try {
      const session = await fetchSessionDetail(caseItem.session_id);
      setCurrentImageIndex(0);
      setCurrentCase(caseItem);
      setCurrentSession(session);
    } catch (err) {
      toast.error('Unable to load that case. Please try again.');
    } finally {
      setLoadingCase(false);
    }
  };

  const handleCompleteCase = async () => {
    setValidationError(null);
    setError(null);
    if (!grade) {
      const msg = 'Please select a grade before submitting.';
      setValidationError(msg);
      setShowInfo(true);
      toast.error(msg);
      return;
    }
    if (REASON_REQUIRED_GRADES.includes(grade) && !reason.trim()) {
      const msg = 'Please enter a reason before submitting.';
      setValidationError(msg);
      setShowInfo(true);
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      const response = await apiPost(`/api/v1/qc/radiologist/cases/${currentCase.case_id}/complete`, {
        grade,
        reason: reason.trim() || null,
        left: { birads: leftFindings.birads || null, birads_4_sub: leftFindings.birads_4_sub || null, density: leftFindings.density || null },
        right: { birads: rightFindings.birads || null, birads_4_sub: rightFindings.birads_4_sub || null, density: rightFindings.density || null },
        case_notes: caseNotes,
      });
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

  const handleNext = () => {
    if (currentImageIndex < images.length - 1) setCurrentImageIndex(i => i + 1);
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0) setCurrentImageIndex(i => i - 1);
  };

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
          {readOnly && <span style={styles.readOnlyBadge}>Admin — Read Only</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={styles.navBtn(currentImageIndex === 0)} disabled={currentImageIndex === 0} onClick={handlePrevious}>
            &#8592; Previous Image
          </button>
          <span style={{ fontSize: 13, color: '#cfd6d8', minWidth: 100, textAlign: 'center' }}>
            Image {currentImageIndex + 1} of {images.length}
          </span>
          <button style={styles.navBtn(isLastImage)} disabled={isLastImage} onClick={handleNext}>
            Next Image →
          </button>
          <span style={styles.headerDivider} />
          <button style={styles.navBtn(loadingCase || !previousCaseInQueue)} disabled={loadingCase || !previousCaseInQueue} onClick={() => goToCase(previousCaseInQueue)}>
            &#8592; Previous Case
          </button>
          <button style={styles.navBtn(loadingCase || !nextCaseInQueue)} disabled={loadingCase || !nextCaseInQueue} onClick={() => goToCase(nextCaseInQueue)}>
            Next Case →
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isReportItem && (
            <>
              <button style={styles.zoomBtn(zoomIdx === 0)} disabled={zoomIdx === 0} onClick={() => setZoomIdx(i => Math.max(0, i - 1))}>&minus;</button>
              <span style={{ fontSize: 12.5, minWidth: 40, textAlign: 'center', color: '#cfd6d8' }}>{zoom}&times;</span>
              <button style={styles.zoomBtn(zoomIdx === ZOOM_STEPS.length - 1)} disabled={zoomIdx === ZOOM_STEPS.length - 1} onClick={() => setZoomIdx(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}>+</button>
            </>
          )}
          <button style={styles.infoBtn(showInfo)} onClick={() => setShowInfo(v => !v)}>{showInfo ? 'Hide Details' : 'Show Details'}</button>
        </div>
      </div>

      <div className="qc-cv-body">
        <div className="qc-cv-viewer-area">
          {/* The canvas stays mounted at this same spot across every status —
              conditionally swapping in a *different* <canvas> element once
              status flips to 'canvas' would hand the ref to a fresh, blank
              DOM node instead of the one useAttachmentImage already decoded
              pixels onto, leaving the visible canvas empty. Only its
              visibility toggles. */}
          <div style={styles.imageScroll}>
            {!isReportItem && (
              <>
                {imageStatus === 'loading' && <div style={styles.centerMsg}>Loading image…</div>}
                {imageStatus === 'error' && <div style={styles.centerMsg}>Unable to load image. Please try again.</div>}
                {imageStatus === 'img' && (
                  <img
                    src={blobUrl}
                    alt={imageLabel}
                    style={mediaStyle(zoom, brightness, contrast)}
                  />
                )}
                <canvas
                  ref={canvasRef}
                  style={{ ...mediaStyle(zoom, brightness, contrast), display: imageStatus === 'canvas' ? 'block' : 'none' }}
                />
              </>
            )}
            {isReportItem && (
              <>
                {reportStatus === 'loading' && <div style={styles.centerMsg}>Loading report…</div>}
                {reportStatus === 'error' && <div style={styles.centerMsg}>Unable to load report. Please try again.</div>}
                {reportStatus === 'empty' && <div style={styles.centerMsg}>No mammography report on this case.</div>}
                {reportStatus === 'pdf' && (
                  <iframe src={reportBlobUrl} title="Mammography Report" style={styles.reportFrame} />
                )}
                {reportStatus === 'img' && (
                  <img src={reportBlobUrl} alt="Mammography Report" style={mediaStyle(zoom, brightness, contrast)} />
                )}
                {reportStatus === 'docx' && (
                  <div style={styles.docxFrame}>
                    <div dangerouslySetInnerHTML={{ __html: docxHtml }} style={styles.docxBody} />
                  </div>
                )}
                {reportStatus === 'unknown' && <div style={styles.centerMsg}>Preview not available for this file type.</div>}
              </>
            )}
          </div>

          {showInfo && (
            <div className="qc-cv-meta-panel">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{imageLabel}</div>
              <MetaRow label="Case ID" value={currentCase.qc_subject_id} />
              <MetaRow label="Image file" value={currentImage && currentImage.attachment.qc_file_name} />
              <MetaRow label="File type" value={currentImage && currentImage.key} />
              <MetaRow label="Format" value={meta ? meta.format : '—'} />
              {!isReportItem && <MetaRow label="Dimensions" value={meta && meta.cols && meta.rows ? `${meta.cols} × ${meta.rows}` : '—'} />}
              {!isReportItem && <MetaRow label="Bit depth" value={meta && meta.bitsAllocated ? `${meta.bitsAllocated}-bit` : '—'} />}
              {!isReportItem && <MetaRow label="Compression" value={meta ? (meta.compressed ? 'Compressed' : 'Uncompressed') : '—'} />}
              <MetaRow label="File size" value={meta ? fmtBytes(meta.fileSizeBytes) : '—'} />
            </div>
          )}

          {!isReportItem && (
          <div className="qc-cv-adjust-panel">
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
          )}
        </div>

        {showInfo && (
          <div className="qc-cv-review-panel">
            {isLastImage && (
              <div style={{ ...styles.panelSection, ...(hasSubmittedGrade ? styles.reviewedPanelSection : {}) }}>
                <div style={styles.panelTitle}>
                  {hasSubmittedGrade ? '✓ Submitted Review' : 'Image Review — combined for this case'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {GRADES.map(g => (
                    <label key={g} style={styles.radioRow(grade === g, hasSubmittedGrade)}>
                      <input
                        type="radio"
                        name="grade"
                        checked={grade === g}
                        disabled={locked}
                        onChange={() => { setGrade(g); setValidationError(null); }}
                      />
                      {g}
                    </label>
                  ))}
                </div>
                {(REASON_REQUIRED_GRADES.includes(grade) || (locked && reason)) && (
                  <div style={{ marginTop: 10 }}>
                    <label style={styles.smallLabel}>Reason / Comment{locked ? '' : ' *'}</label>
                    <textarea
                      style={{ ...styles.textarea, ...(hasSubmittedGrade ? styles.reviewedTextarea : {}) }}
                      value={reason}
                      disabled={locked}
                      onChange={(e) => { setReason(e.target.value); setValidationError(null); }}
                      placeholder="Describe the issue..."
                    />
                  </div>
                )}
                {readOnly && !hasSubmittedGrade && (
                  <div style={{ fontSize: 12, color: '#8a949c', marginTop: 8 }}>Not yet reviewed by the assigned Radiologist.</div>
                )}
                {validationError && <div style={styles.errorText}>{validationError}</div>}
              </div>
            )}

            <div style={styles.panelSection}>
              <div style={styles.panelTitle}>Additional Clinical Information</div>
              <BreastFindingsFields label="Left Breast" data={leftFindings} readOnly />
              <BreastFindingsFields label="Right Breast" data={rightFindings} readOnly />
              <div style={{ marginTop: 10 }}>
                <label style={styles.smallLabel}>Notes / Comments</label>
                <textarea
                  style={styles.textarea}
                  value={caseNotes}
                  disabled={locked}
                  onChange={(e) => setCaseNotes(e.target.value)}
                  placeholder="Case notes..."
                />
              </div>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}

            {locked ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={styles.completedNote}>
                  {isCompleted ? 'This case has been completed. Review details are read-only.' : 'Viewing as Admin — read-only.'}
                </div>
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
            ) : isLastImage ? (
              <div style={styles.panelActions}>
                <button style={styles.primaryBtn} disabled={saving} onClick={handleCompleteCase}>
                  {saving ? 'Submitting…' : 'Complete Case'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#8a949c', textAlign: 'center' }}>
                View all {images.length} items, then submit the combined review on the last one.
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
    padding: '5px 12px', borderRadius: 8, border: '1px solid #4a5a5b', background: '#14868C',
    color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  navBtn: (disabled) => ({
    padding: '5px 10px', borderRadius: 8, border: '1px solid #3a4444',
    background: disabled ? '#161616' : '#1b1b1b', color: disabled ? '#555' : '#e8eaea',
    fontWeight: 600, fontSize: 13, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  }),
  headerDivider: { width: 1, alignSelf: 'stretch', background: '#2c3636', margin: '0 4px' },
  zoomBtn: (disabled) => ({
    minWidth: 32, padding: '4px 8px', borderRadius: 6, border: '1px solid #3a4444',
    background: '#1b1b1b', color: disabled ? '#555' : '#e8eaea', fontWeight: 600, fontSize: 14,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }),
  infoBtn: (on) => ({
    padding: '4px 9px', borderRadius: 6, border: '1px solid #3a4444',
    background: on ? '#243030' : '#1b1b1b', color: on ? '#e8eaea' : '#8a949c',
    fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  }),
  imageScroll: { flex: 1, overflow: 'auto', display: 'flex' },
  reportFrame: { width: '100%', height: '100%', border: 'none', background: '#fff' },
  docxFrame: { width: '100%', height: '100%', overflow: 'auto', background: '#fff', padding: 'clamp(16px, 5vw, 40px) clamp(16px, 6vw, 60px)', boxSizing: 'border-box' },
  docxBody: { maxWidth: 800, margin: '0 auto', fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", fontSize: 14, lineHeight: 1.7, color: '#222' },
  centerMsg: { margin: 'auto', color: '#cfd6d8', fontSize: 14 },
  adjustRow: { display: 'flex', alignItems: 'center', gap: 8 },
  adjustLabel: { fontSize: 11, color: '#cfd6d8', minWidth: 90 },
  resetBtn: {
    padding: '3px 8px', borderRadius: 6, border: '1px solid #3a4444', background: '#1b1b1b',
    color: '#e8eaea', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  panelSection: { background: '#1d2222', borderRadius: 10, padding: 14 },
  reviewedPanelSection: { border: '1px solid #14868C', boxShadow: '0 0 0 1px rgba(20,134,140,0.35)' },
  panelTitle: { fontSize: 13, fontWeight: 700, color: '#e8eaea', marginBottom: 10 },
  radioRow: (checked, highlighted) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6,
    fontSize: 13, fontWeight: checked ? 700 : 400,
    color: checked ? (highlighted ? '#eafff5' : '#e8eaea') : '#b6bfc0',
    background: checked ? (highlighted ? '#14868C' : '#243030') : 'transparent',
    border: checked && highlighted ? '1px solid #6ee7b7' : '1px solid transparent',
    cursor: highlighted ? 'default' : 'pointer',
  }),
  reviewedTextarea: { border: '1px solid #14868C', background: '#0f2323' },
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
  readOnlyBadge: {
    padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700,
    backgroundColor: '#2a2a1d', color: '#e0d06e',
  },
  completedNote: {
    marginTop: 'auto', padding: '10px 12px', borderRadius: 8, background: '#1d3a2d',
    color: '#8fd8b1', fontSize: 12.5, fontWeight: 500, textAlign: 'center',
  },
  primaryBtn: {
    flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', background: '#14868C',
    color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  secondaryBtn: {
    flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #3a4444', background: '#1b1b1b',
    color: '#e8eaea', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  completionCard: {
    margin: 'auto', textAlign: 'center', color: '#e8eaea', background: '#1d2222',
    borderRadius: 16, padding: '40px 48px', maxWidth: 420,
  },
};

export default DicomCaseViewer;
