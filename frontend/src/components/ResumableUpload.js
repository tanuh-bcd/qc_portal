import React, { useState, useRef } from 'react';
import { Upload, Eye } from 'lucide-react';

const ResumableUpload = ({ label, hint, accept, fileType, sessionId, existing, onComplete, onView, readOnly = false }) => {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [uploadedAttachment, setUploadedAttachment] = useState(null);
  const xhrRef = useRef(null);

  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    setFile(selected);
    setProgress(0);
    setError(null);
    setDone(false);
  };

  const upload = async () => {
    if (!file || !sessionId) return;
    setUploading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.REACT_APP_API_URL || '';

      const formData = new FormData();
      formData.append('file_type', fileType);
      formData.append('file_name', file.name);
      formData.append('session_id', sessionId);

      const urlRes = await fetch(`${apiUrl}/api/v1/patient/upload-url`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!urlRes.ok) {
        const errBody = await urlRes.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to get upload URL (${urlRes.status})`);
      }
      const { upload_url, gcs_url } = await urlRes.json();

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.send(file);
      });

      const completeForm = new FormData();
      completeForm.append('session_id', sessionId);
      completeForm.append('file_type', fileType);
      completeForm.append('file_name', file.name);
      completeForm.append('gcs_url', gcs_url);
      completeForm.append('mime_type', file.type || 'application/octet-stream');

      const completeRes = await fetch(`${apiUrl}/api/v1/patient/upload-complete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: completeForm,
      });
      const completeData = await completeRes.json();

      setDone(true);
      setProgress(100);
      if (completeData.attachment) setUploadedAttachment(completeData.attachment);
      if (onComplete) onComplete(fileType, gcs_url);

    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      xhrRef.current = null;
    }
  };

  const cancel = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setUploading(false);
    setProgress(0);
  };

  const fileSizeLabel = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const hasExisting = !!existing;
  const fileInputRef = useRef(null);

  if (readOnly) {
    return (
      <div style={{
        border: '1px solid #e0e7eb',
        borderRadius: 12,
        padding: '12px 16px',
        background: '#fafefe',
      }}>
        <div style={{ fontSize: 13, color: '#14868C', fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {hasExisting ? (
          <div style={{ fontSize: 12, color: '#333', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{existing.file_name}</span>
            {onView && (
              <button
                type="button"
                onClick={() => onView(existing)}
                style={{
                  background: 'none', border: '1px solid #14868C', borderRadius: 4,
                  color: '#14868C', cursor: 'pointer', padding: '2px 6px',
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: 'inherit',
                }}
              >
                <Eye size={12} /> View
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#999' }}>No file uploaded</div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      border: done ? '2px solid #14868C' : '2px dashed #c8e0e2',
      borderRadius: 12,
      padding: '16px',
      background: done ? '#e8f7f8' : '#fafefe',
      transition: 'all 0.2s',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 13, color: '#14868C', fontWeight: 600, marginBottom: 4 }}>{label}</div>

      {hasExisting && !file && !done && (
        <div style={{ fontSize: 12, color: '#14868C', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>Existing: {existing.file_name}</span>
          {onView && (
            <button
              type="button"
              onClick={() => onView(existing)}
              style={{
                background: 'none', border: '1px solid #14868C', borderRadius: 4,
                color: '#14868C', cursor: 'pointer', padding: '2px 6px',
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: 'inherit',
              }}
            >
              <Eye size={12} /> View
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{hint}</div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        disabled={uploading}
        style={{ display: 'none' }}
      />

      {!file && !done && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 8, width: '100%',
            border: '1.5px solid #14868C', background: '#fff', color: '#14868C',
            fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Upload size={15} />
          Choose File
        </button>
      )}

      {file && !done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 12px', background: '#f0fafb', borderRadius: 8, border: '1px solid #c8e0e2', minWidth: 0 }}>
          <span style={{ flex: 1, fontSize: 12, color: '#333', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{file.name}</span>
          <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{fileSizeLabel(file.size)}</span>
          <button type="button" onClick={() => { setFile(null); setProgress(0); }} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>&times;</button>
        </div>
      )}

      {file && !done && !uploading && (
        <button
          type="button"
          onClick={upload}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 8, border: 'none',
            background: '#14868C', color: '#fff', fontWeight: 600,
            fontSize: 13, cursor: 'pointer', width: '100%', fontFamily: 'inherit',
          }}
        >
          <Upload size={15} />
          Upload
        </button>
      )}

      {uploading && (
        <div>
          <div style={{
            height: 8, background: '#e0e0e0', borderRadius: 4,
            overflow: 'hidden', marginBottom: 6,
          }}>
            <div style={{
              height: '100%', background: '#14868C', borderRadius: 4,
              width: `${progress}%`, transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#14868C', fontWeight: 600 }}>{progress}%</span>
            <button onClick={cancel} style={{
              background: 'none', border: 'none', color: '#dc3545',
              cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}>Cancel</button>
          </div>
        </div>
      )}

      {done && (
        <div style={{ fontSize: 12, color: '#155724', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>&#10003; Uploaded successfully</span>
          {onView && uploadedAttachment && (
            <button
              type="button"
              onClick={() => onView(uploadedAttachment)}
              style={{
                background: 'none', border: '1px solid #14868C', borderRadius: 4,
                color: '#14868C', cursor: 'pointer', padding: '2px 6px',
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: 'inherit',
              }}
            >
              <Eye size={12} /> View
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#dc3545', marginTop: 4 }}>
          {error}
          <button onClick={upload} style={{
            background: 'none', border: 'none', color: '#14868C',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, marginLeft: 8,
          }}>Retry</button>
        </div>
      )}
    </div>
  );
};

export default ResumableUpload;
