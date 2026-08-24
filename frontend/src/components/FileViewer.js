import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Loader } from 'lucide-react';
import dicomParser from 'dicom-parser';
import mammoth from 'mammoth';

const FILE_TYPE_LABELS = {
  mammo_cc_left: 'CC Left',
  mammo_cc_right: 'CC Right',
  mammo_mlo_left: 'MLO Left',
  mammo_mlo_right: 'MLO Right',
  mammo_reading: 'Mammography Report',
  us_video: 'Breast Ultrasound (USG Breast)',
  us_reading: 'Breast Ultrasound Report',
  biopsy_reading: 'Biopsy Report',
  annot_cc_left: 'CC Left Annotation',
  annot_mlo_left: 'MLO Left Annotation',
  annot_cc_right: 'CC Right Annotation',
  annot_mlo_right: 'MLO Right Annotation',
};

const ADDITIONAL_LABELS = {
  additional_histopathology: 'Histopathology Report',
  additional_ihc: 'IHC Report',
  additional_prior_imaging: 'Prior Breast Imaging',
  additional_mammo_views: 'Additional Mammography Views',
  additional_other_imaging: 'Other Imaging Report',
};

function getDisplayLabel(fileTypeKey, fileName) {
  if (fileTypeKey) {
    if (FILE_TYPE_LABELS[fileTypeKey]) return FILE_TYPE_LABELS[fileTypeKey];
    for (const [prefix, label] of Object.entries(ADDITIONAL_LABELS)) {
      if (fileTypeKey.startsWith(prefix)) return label;
    }
  }
  return fileName;
}

const FileViewer = ({ attachmentId, fileName, mimeType, fileTypeKey, onClose }) => {
  const displayLabel = getDisplayLabel(fileTypeKey, fileName);
  const [blobUrl, setBlobUrl] = useState(null);
  const [dicomBuffer, setDicomBuffer] = useState(null);
  const [docxHtml, setDocxHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resolvedFileType, setResolvedFileType] = useState(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const backendRetried = useRef(false);

  const fileType = resolvedFileType || getFileType(fileName, mimeType, fileTypeKey);

  useEffect(() => {
    const fetchFile = async () => {
      try {
        const token = localStorage.getItem('token');
        const apiUrl = process.env.REACT_APP_API_URL || '';

        let res;
        let effectiveType = getFileType(fileName, mimeType, fileTypeKey);
        let correctMime = mimeType || 'application/octet-stream';

        // Try signed URL first (direct GCS download, faster)
        try {
          const urlRes = await fetch(`${apiUrl}/api/v1/patient/view-url/${attachmentId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (urlRes.ok) {
            const { view_url, mime_type: serverMime } = await urlRes.json();
            if (serverMime) correctMime = serverMime;
            if (serverMime && serverMime.includes('dicom')) effectiveType = 'dicom';
            res = await fetch(view_url);
            if (!res.ok) throw new Error('Signed URL fetch failed');
          } else {
            throw new Error('view-url not available');
          }
        } catch {
          // Fallback to proxied download through backend
          res = await fetch(`${apiUrl}/api/v1/patient/view-file/${attachmentId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || `Server error (${res.status})`);
          }
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/dicom')) effectiveType = 'dicom';
          correctMime = contentType || correctMime;
        }

        setResolvedFileType(effectiveType);

        if (effectiveType === 'dicom') {
          const arrayBuffer = await res.arrayBuffer();
          setDicomBuffer({ buffer: arrayBuffer, usedSignedUrl: res.url?.includes('storage.googleapis.com') });
        } else if (effectiveType === 'docx') {
          const arrayBuffer = await res.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(result.value);
        } else {
          const rawBlob = await res.blob();
          const typedBlob = new Blob([rawBlob], { type: correctMime });
          setBlobUrl(URL.createObjectURL(typedBlob));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchFile();

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [attachmentId, fileType]);

  useEffect(() => {
    if (!dicomBuffer) return;

    const buffer = dicomBuffer.buffer || dicomBuffer;
    const usedSignedUrl = dicomBuffer.usedSignedUrl || false;

    const retryViaBackend = async () => {
      try {
        const token = localStorage.getItem('token');
        const apiUrl = process.env.REACT_APP_API_URL || '';
        const res = await fetch(`${apiUrl}/api/v1/patient/view-file/${attachmentId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Backend fallback failed');
        const retryBuffer = await res.arrayBuffer();
        setDicomBuffer({ buffer: retryBuffer, usedSignedUrl: false });
      } catch (err) {
        setError(`DICOM render error: could not decompress file`);
      }
    };

    try {
      const byteArray = new Uint8Array(buffer);

      // Detect non-DICOM files mislabeled with .dcm extension
      if (byteArray[0] === 0xFF && byteArray[1] === 0xD8) {
        setBlobUrl(URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' })));
        setDicomBuffer(null);
        return;
      }
      if (byteArray[0] === 0x89 && byteArray[1] === 0x50) {
        setBlobUrl(URL.createObjectURL(new Blob([buffer], { type: 'image/png' })));
        setDicomBuffer(null);
        return;
      }

      const dataSet = dicomParser.parseDicom(byteArray);

      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) throw new Error('No pixel data found in DICOM file');

      // Handle compressed/encapsulated pixel data
      if (pixelDataElement.encapsulatedPixelData) {
        const fragments = pixelDataElement.fragments;
        if (!fragments || fragments.length === 0) throw new Error('No pixel data fragments in compressed DICOM');

        let totalLen = 0;
        fragments.forEach(f => { totalLen += f.length; });
        const frameData = new Uint8Array(totalLen);
        let pos = 0;
        fragments.forEach(f => {
          frameData.set(byteArray.slice(f.position, f.position + f.length), pos);
          pos += f.length;
        });

        const transferSyntax = dataSet.string('x00020010') || '';
        const isJp2 = transferSyntax.includes('1.2.840.10008.1.2.4.90') || transferSyntax.includes('1.2.840.10008.1.2.4.91');
        const mime = isJp2 ? 'image/jp2' : 'image/jpeg';

        setBlobUrl(URL.createObjectURL(new Blob([frameData], { type: mime })));
        setDicomBuffer(null);
        return;
      }

      // Uncompressed pixel data — render to canvas
      const rows = dataSet.uint16('x00280010');
      const cols = dataSet.uint16('x00280011');
      if (!rows || !cols) throw new Error('Invalid DICOM dimensions');

      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      const bitsStored = dataSet.uint16('x00280101') || bitsAllocated;
      const pixelRepresentation = dataSet.uint16('x00280103') || 0;
      const samplesPerPixel = dataSet.uint16('x00280002') || 1;
      const photometric = dataSet.string('x00280004') || 'MONOCHROME2';

      const wcStr = dataSet.string('x00281050');
      const wwStr = dataSet.string('x00281051');
      const windowCenter = wcStr ? parseFloat(wcStr.split('\\')[0]) : (1 << (bitsStored - 1));
      const windowWidth = wwStr ? parseFloat(wwStr.split('\\')[0]) : (1 << bitsStored);

      const offset = pixelDataElement.dataOffset;
      const buf = dataSet.byteArray.buffer;
      const bytesPerPixel = bitsAllocated === 16 ? 2 : 1;
      const expectedSize = rows * cols * (samplesPerPixel === 3 ? 3 : bytesPerPixel);
      if (offset + expectedSize > buf.byteLength) {
        throw new Error('Pixel data truncated or corrupted');
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(cols, rows);

      if (samplesPerPixel === 3) {
        for (let i = 0; i < rows * cols; i++) {
          const base = offset + i * 3;
          imageData.data[i * 4] = dataSet.byteArray[base];
          imageData.data[i * 4 + 1] = dataSet.byteArray[base + 1];
          imageData.data[i * 4 + 2] = dataSet.byteArray[base + 2];
          imageData.data[i * 4 + 3] = 255;
        }
      } else {
        const minVal = windowCenter - windowWidth / 2;
        const maxVal = windowCenter + windowWidth / 2;
        const pixelData = new DataView(buf, offset, pixelDataElement.length);

        for (let i = 0; i < rows * cols; i++) {
          let pv;
          if (bitsAllocated === 16) {
            pv = pixelRepresentation === 1
              ? pixelData.getInt16(i * 2, true)
              : pixelData.getUint16(i * 2, true);
          } else {
            pv = pixelData.getUint8(i);
          }

          let mapped;
          if (pv <= minVal) mapped = 0;
          else if (pv >= maxVal) mapped = 255;
          else mapped = Math.round(((pv - minVal) / windowWidth) * 255);

          if (photometric === 'MONOCHROME1') mapped = 255 - mapped;

          imageData.data[i * 4] = mapped;
          imageData.data[i * 4 + 1] = mapped;
          imageData.data[i * 4 + 2] = mapped;
          imageData.data[i * 4 + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    } catch (err) {
      if (usedSignedUrl) {
        retryViaBackend();
      } else {
        setError(`DICOM render error: ${err.message}`);
      }
    }
  }, [dicomBuffer, attachmentId]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(prev => Math.max(0.1, Math.min(10, prev + (e.deltaY > 0 ? -0.15 : 0.15))));
  }, []);

  const handleMouseDown = (e) => {
    if (fileType === 'pdf' || fileType === 'docx') return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);

  const zoomIn = () => setZoom(prev => Math.min(10, prev + 0.25));
  const zoomOut = () => setZoom(prev => Math.max(0.1, prev - 0.25));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.container} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.fileName}>{displayLabel}</div>
          <div style={styles.controls}>
            <button type="button" onClick={zoomOut} style={styles.controlBtn} title="Zoom Out"><ZoomOut size={18} /></button>
            <button type="button" onClick={zoomIn} style={styles.controlBtn} title="Zoom In"><ZoomIn size={18} /></button>
            <button type="button" onClick={resetView} style={styles.controlBtn} title="Reset"><RotateCcw size={18} /></button>
            <button type="button" onClick={onClose} style={styles.closeBtn} title="Close"><X size={20} /></button>
          </div>
        </div>

        <div
          ref={containerRef}
          style={styles.content}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loading && (
            <div style={styles.center}>
              <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 12, color: '#666' }}>Loading file...</div>
            </div>
          )}

          {error && (
            <div style={styles.center}>
              <div style={{ color: '#dc3545', fontSize: 16 }}>{error}</div>
            </div>
          )}

          {!loading && !error && blobUrl && fileType === 'pdf' && (
            <iframe
              src={blobUrl}
              title={fileName}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          )}

          {!loading && !error && blobUrl && (fileType === 'image' || fileType === 'dicom') && (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab',
            }}>
              <img
                src={blobUrl}
                alt={fileName}
                draggable={false}
                onError={async () => {
                  if (fileType !== 'dicom' || backendRetried.current) {
                    setError('Could not render image');
                    return;
                  }
                  backendRetried.current = true;
                  try {
                    const token = localStorage.getItem('token');
                    const apiUrl = process.env.REACT_APP_API_URL || '';
                    const res = await fetch(`${apiUrl}/api/v1/patient/view-file/${attachmentId}`, {
                      headers: { 'Authorization': `Bearer ${token}` },
                    });
                    if (!res.ok) throw new Error('fallback failed');
                    const buf = await res.arrayBuffer();
                    URL.revokeObjectURL(blobUrl);
                    setBlobUrl(null);
                    setDicomBuffer({ buffer: buf, usedSignedUrl: false });
                  } catch {
                    setError('Could not load DICOM image');
                  }
                }}
                style={{
                  maxWidth: '100%', maxHeight: '100%',
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transition: dragging ? 'none' : 'transform 0.15s ease',
                  userSelect: 'none',
                }}
              />
            </div>
          )}

          {!error && dicomBuffer && fileType === 'dicom' && (
            <div style={{
              width: '100%', height: '100%',
              display: loading ? 'none' : 'flex',
              alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab',
              background: '#000',
            }}>
              <canvas
                ref={canvasRef}
                draggable={false}
                style={{
                  maxWidth: '100%', maxHeight: '100%',
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transition: dragging ? 'none' : 'transform 0.15s ease',
                  imageRendering: 'pixelated',
                }}
              />
            </div>
          )}

          {!loading && !error && docxHtml && fileType === 'docx' && (
            <div style={{
              width: '100%', height: '100%', overflow: 'auto',
              background: '#fff', padding: '40px 60px',
              boxSizing: 'border-box',
            }}>
              <div
                dangerouslySetInnerHTML={{ __html: docxHtml }}
                style={{
                  maxWidth: 800, margin: '0 auto',
                  fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                  fontSize: 14, lineHeight: 1.7, color: '#222',
                }}
              />
            </div>
          )}

          {!loading && !error && blobUrl && fileType === 'unknown' && (
            <div style={styles.center}>
              <div style={{ color: '#666', fontSize: 14, textAlign: 'center' }}>
                Preview not available for this file type.
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

function getFileType(fileName, mimeType, fileTypeKey) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (['dcm', 'dicom'].includes(ext) || mimeType === 'application/dicom') return 'dicom';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext) || (mimeType && mimeType.startsWith('image/'))) return 'image';
  if (fileTypeKey && (fileTypeKey.startsWith('mammo_cc') || fileTypeKey.startsWith('mammo_mlo'))) return 'dicom';
  return 'unknown';
}

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
  },
  container: {
    width: '92vw', height: '90vh',
    backgroundColor: '#1a1a1a',
    borderRadius: 12, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 16px',
    background: '#222', borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  fileName: {
    color: '#eee', fontSize: 14, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: '50%',
  },
  controls: {
    display: 'flex', gap: 4, alignItems: 'center',
  },
  controlBtn: {
    background: 'none', border: '1px solid #444',
    color: '#ccc', borderRadius: 6, padding: '6px 8px',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    fontFamily: 'inherit', transition: 'background 0.15s',
  },
  closeBtn: {
    background: '#dc3545', border: 'none',
    color: '#fff', borderRadius: 6, padding: '6px 8px',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    marginLeft: 8, fontFamily: 'inherit',
  },
  content: {
    flex: 1, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  center: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%',
  },
};

export default FileViewer;
