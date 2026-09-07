import React, { useEffect, useRef, useState } from 'react';
import useAttachmentImage from '../hooks/useAttachmentImage';

const TEAL = '#14868C';

const VIEW_TYPES = [
  { key: 'mammo_cc_left', proj: 'CC', side: 'Left' },
  { key: 'mammo_mlo_left', proj: 'MLO', side: 'Left' },
  { key: 'mammo_cc_right', proj: 'CC', side: 'Right' },
  { key: 'mammo_mlo_right', proj: 'MLO', side: 'Right' },
];

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

const fmtBytes = (bytes) => {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const s = {
  wrap: { fontFamily: "'Inter', -apple-system, sans-serif" },
  banner: {
    background: `linear-gradient(135deg, ${TEAL} 0%, #0e6a6f 100%)`, color: '#fff', borderRadius: 12,
    padding: '14px 20px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
  },
  badge: (ok) => ({
    background: ok ? '#d4edda' : '#fff3cd', color: ok ? '#155724' : '#856404',
    padding: '4px 12px', borderRadius: 12, fontSize: 12.5, fontWeight: 700,
  }),
  // Four tiles across the full width on a wide screen, dropping to 2 then 1
  // as space runs out. Height is capped so the row stays short — these are
  // previews, full screen is where you actually read them.
  imgGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
    gap: 12,
    marginBottom: 18,
    width: '100%',
  },
  card: { border: '1.5px solid #e8f4f5', borderRadius: 10, overflow: 'hidden', background: '#fff' },
  imgFrame: (clickable) => ({
    background: '#000', height: 'clamp(150px, 20vh, 230px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden', cursor: clickable ? 'zoom-in' : 'default',
  }),
  media: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' },
  imgTag: { position: 'absolute', top: 6, left: 8, color: '#eaeaea', fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textShadow: '0 1px 2px rgba(0,0,0,0.7)', zIndex: 1 },
  expandBtn: {
    position: 'absolute', bottom: 6, right: 6, zIndex: 2,
    padding: '3px 8px', fontSize: 10.5, fontWeight: 600, color: '#eaeaea',
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
  },
  emptyFrame: { color: '#8a949c', fontSize: 11.5, fontWeight: 600, padding: '0 10px', textAlign: 'center' },
  loadingFrame: { color: '#cfd6d8', fontSize: 11.5, fontWeight: 600 },
  errorFrame: { color: '#e59a8f', fontSize: 11, fontWeight: 600, padding: '0 10px', textAlign: 'center' },
  metaBox: { padding: '8px 10px', background: '#fafbfc', borderTop: '1px solid #eef2f2' },
  metaRow: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '1px 0' },
  metaLabel: { color: '#8a949c' },
  metaVal: { color: '#3a4448', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  notice: {
    display: 'flex', gap: 10, padding: '12px 16px', marginBottom: 18, borderRadius: 10,
    background: '#fffaf0', border: '1.5px solid #f0dca8', fontSize: 13, color: '#7a5c0a', fontWeight: 500,
  },
  checkRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 14 },
  checkItem: { fontSize: 12.5 },
  checkLabel: { color: '#7c8a8d', marginBottom: 3 },
  checkVal: (ok) => ({ fontWeight: 700, color: ok ? '#2f9e6e' : '#d9534f' }),

  /* single-image full screen */
  fsOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0d0d0d',
    zIndex: 1000, display: 'flex', flexDirection: 'column',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  fsHeader: {
    flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 14, flexWrap: 'wrap', padding: '10px clamp(12px, 3vw, 24px)',
    borderBottom: '1px solid #262626', color: '#e8eaea',
  },
  fsBackBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid #4a5a5b', background: '#14868C',
    color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  fsZoomBtn: (disabled) => ({
    minWidth: 36, padding: '6px 10px', borderRadius: 6, border: '1px solid #3a4444',
    background: '#1b1b1b', color: disabled ? '#555' : '#e8eaea', fontWeight: 600, fontSize: 14,
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }),
  fsBody: { flex: 1, overflow: 'auto', display: 'flex', background: '#000' },
  // Pinned to the overlay (not the scroll container) so it stays put while panning.
  fsMetaPanel: {
    position: 'absolute', top: 68, right: 'clamp(12px, 3vw, 24px)', zIndex: 3,
    minWidth: 190, padding: '10px 12px', borderRadius: 8,
    background: 'rgba(12,12,12,0.72)', border: '1px solid rgba(255,255,255,0.16)',
    backdropFilter: 'blur(3px)', pointerEvents: 'none',
  },
  fsMetaRow: { display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, padding: '2px 0' },
  fsMetaLabel: { color: '#98a3a5' },
  fsMetaVal: { color: '#f0f2f2', fontWeight: 600 },
  fsInfoBtn: (on) => ({
    padding: '6px 12px', borderRadius: 6, border: '1px solid #3a4444',
    background: on ? '#243030' : '#1b1b1b', color: on ? '#e8eaea' : '#8a949c',
    fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  }),
};

/* ------------------------------------------------------------------
   Full-screen view of a single mammography view. It reuses the pixels
   already decoded by the tile (blob URL, or a copy of the tile canvas)
   rather than re-fetching and re-decoding the DICOM.
------------------------------------------------------------------- */
function FullscreenView({ view, source, meta, onClose }) {
  const canvasRef = useRef(null);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const zoom = ZOOM_STEPS[zoomIdx];

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (source.type !== 'canvas' || !source.canvas || !canvasRef.current) return;
    const dst = canvasRef.current;
    dst.width = source.canvas.width;
    dst.height = source.canvas.height;
    dst.getContext('2d').drawImage(source.canvas, 0, 0);
  }, [source]);

  // At 1x the image fits the viewport; above that it takes a real layout
  // width so the scroll container can actually pan over it.
  const fit = zoom === 1;
  const mediaStyle = fit
    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated', margin: 'auto', display: 'block' }
    : { width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto', imageRendering: 'pixelated', margin: 'auto', display: 'block' };

  return (
    <div style={s.fsOverlay}>
      <div style={s.fsHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button style={s.fsBackBtn} onClick={onClose}>&#8592; Back to all views</button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{view.proj} — {view.side}</div>
            <div style={{ fontSize: 11.5, color: '#8a949c' }}>Press Esc to go back</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            style={s.fsZoomBtn(zoomIdx === 0)}
            disabled={zoomIdx === 0}
            onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
          >&minus;</button>
          <span style={{ fontSize: 12.5, minWidth: 56, textAlign: 'center', color: '#cfd6d8' }}>
            {fit ? 'Fit' : `${zoom}×`}
          </span>
          <button
            style={s.fsZoomBtn(zoomIdx === ZOOM_STEPS.length - 1)}
            disabled={zoomIdx === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIdx(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          >+</button>
          {meta && (
            <button style={s.fsInfoBtn(showInfo)} onClick={() => setShowInfo(v => !v)}>
              {showInfo ? 'Hide info' : 'Show info'}
            </button>
          )}
        </div>
      </div>

      <div style={s.fsBody}>
        {source.type === 'img'
          ? <img src={source.src} alt={`${view.proj} ${view.side}`} style={mediaStyle} />
          : <canvas ref={canvasRef} style={mediaStyle} />}
      </div>

      {meta && showInfo && (
        <div style={s.fsMetaPanel}>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>Format</span><span style={s.fsMetaVal}>{meta.format || '—'}</span></div>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>Dimensions</span><span style={s.fsMetaVal}>{meta.cols && meta.rows ? `${meta.cols} × ${meta.rows}` : '—'}</span></div>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>Bit depth</span><span style={s.fsMetaVal}>{meta.bitsAllocated ? `${meta.bitsAllocated}-bit` : '—'}</span></div>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>Photometric</span><span style={s.fsMetaVal}>{meta.photometric || '—'}</span></div>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>Compression</span><span style={s.fsMetaVal}>{meta.compressed === true ? 'Compressed' : meta.compressed === false ? 'Uncompressed' : '—'}</span></div>
          <div style={s.fsMetaRow}><span style={s.fsMetaLabel}>File size</span><span style={s.fsMetaVal}>{fmtBytes(meta.fileSizeBytes)}</span></div>
        </div>
      )}
    </div>
  );
}

function ImagePane({ meta: viewMeta, attachment, onExpand }) {
  const { canvasRef, status, blobUrl, meta, errorMsg } = useAttachmentImage(attachment);
  const canExpand = (status === 'img' && !!blobUrl) || (status === 'canvas' && !!canvasRef.current);

  const expand = () => {
    if (status === 'img' && blobUrl) {
      onExpand({ view: viewMeta, source: { type: 'img', src: blobUrl }, meta });
    } else if (status === 'canvas' && canvasRef.current) {
      onExpand({ view: viewMeta, source: { type: 'canvas', canvas: canvasRef.current }, meta });
    }
  };

  return (
    <div style={s.card}>
      <div style={s.imgFrame(canExpand)} onClick={canExpand ? expand : undefined}>
        <span style={s.imgTag}>{viewMeta.proj} — {viewMeta.side}</span>
        {status === 'empty' && <span style={s.emptyFrame}>No file on record</span>}
        {status === 'loading' && <span style={s.loadingFrame}>Loading…</span>}
        {status === 'error' && <span style={s.errorFrame}>{errorMsg || "Couldn't load image"}</span>}
        {status === 'img' && <img src={blobUrl} alt={`${viewMeta.proj} ${viewMeta.side}`} style={s.media} />}
        {/* Canvas is always mounted so the ref exists before decode runs; hidden until ready */}
        <canvas ref={canvasRef} style={{ ...s.media, display: status === 'canvas' ? 'block' : 'none' }} />
        {canExpand && (
          <button
            type="button"
            style={s.expandBtn}
            onClick={(e) => { e.stopPropagation(); expand(); }}
          >&#9974; Full screen</button>
        )}
      </div>
      <div style={s.metaBox}>
        {meta ? (
          <>
            <div style={s.metaRow}><span style={s.metaLabel}>Format</span><span style={s.metaVal}>{meta.format || '—'}</span></div>
            <div style={s.metaRow}><span style={s.metaLabel}>Dimensions</span><span style={s.metaVal}>{meta.cols && meta.rows ? `${meta.cols} × ${meta.rows}` : '—'}</span></div>
            <div style={s.metaRow}><span style={s.metaLabel}>Bit depth</span><span style={s.metaVal}>{meta.bitsAllocated ? `${meta.bitsAllocated}-bit` : '—'}</span></div>
            <div style={s.metaRow}><span style={s.metaLabel}>File size</span><span style={s.metaVal}>{fmtBytes(meta.fileSizeBytes)}</span></div>
          </>
        ) : (
          <div style={{ fontSize: 11.5, color: '#9aa4ab' }}>{status === 'empty' ? 'No metadata — file not uploaded.' : status === 'error' ? 'Metadata unavailable — decode failed.' : 'Reading header…'}</div>
        )}
      </div>
    </div>
  );
}

export default function BreastCaseReviewPanel({ sessionId, initialData }) {
  const attachments = (initialData && initialData.attachments) || [];
  const getAttachmentByType = (type) => attachments.find(a => a.qc_file_type === type) || null;
  const [expanded, setExpanded] = useState(null); // { view, source, meta }

  let clinicalFindings = { left: {}, right: {} };
  if (initialData && initialData.qc_clinical_findings) {
    clinicalFindings = typeof initialData.qc_clinical_findings === 'string'
      ? JSON.parse(initialData.qc_clinical_findings)
      : initialData.qc_clinical_findings;
  }
  const left = clinicalFindings.left || {};
  const right = clinicalFindings.right || {};

  const allViewsPresent = VIEW_TYPES.every(v => !!getAttachmentByType(v.key));
  const missingViews = VIEW_TYPES.filter(v => !getAttachmentByType(v.key)).map(v => `${v.proj} ${v.side}`);
  const biradsAssigned = !!left.birads && !!right.birads;
  const densityAssigned = !!left.density && !!right.density;

  return (
    <div style={s.wrap}>
      <div style={s.banner}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Mammography Views</div>
        </div>
        <span style={s.badge(allViewsPresent)}>
          {allViewsPresent ? '✓ All DICOMs available' : `${missingViews.length} view(s) missing`}
        </span>
      </div>

      <div style={s.imgGrid}>
        {VIEW_TYPES.map(meta => (
          <ImagePane
            key={meta.key}
            meta={meta}
            attachment={getAttachmentByType(meta.key)}
            onExpand={setExpanded}
          />
        ))}
      </div>

      {!allViewsPresent && (
        <div style={s.notice}>Mammography views not on this case: {missingViews.join(', ')}</div>
      )}

      <div style={s.checkRow}>
        <div style={s.checkItem}>
          <div style={s.checkLabel}>BIRADS (L / R)</div>
          <div style={s.checkVal(biradsAssigned)}>
            {biradsAssigned
              ? `${left.birads}${left.birads_4_sub || ''} / ${right.birads}${right.birads_4_sub || ''}`
              : 'Not recorded'}
          </div>
        </div>
        <div style={s.checkItem}>
          <div style={s.checkLabel}>ACR Density (L / R)</div>
          <div style={s.checkVal(densityAssigned)}>
            {densityAssigned ? `${left.density} / ${right.density}` : 'Not recorded'}
          </div>
        </div>
      </div>

      {expanded && (
        <FullscreenView
          view={expanded.view}
          source={expanded.source}
          meta={expanded.meta}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}