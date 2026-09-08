import { useEffect, useState } from 'react';
import mammoth from 'mammoth';

const getFileType = (fileName, mimeType) => {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext) || (mimeType && mimeType.startsWith('image/'))) return 'image';
  return 'unknown';
};

export default function useAttachmentFile(attachment) {
  const [status, setStatus] = useState(attachment ? 'loading' : 'empty'); 
  const [blobUrl, setBlobUrl] = useState(null);
  const [docxHtml, setDocxHtml] = useState(null);
  const [meta, setMeta] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!attachment) { setStatus('empty'); return; }
    let cancelled = false;
    let createdUrl = null;

    (async () => {
      setStatus('loading');
      setErrorMsg(null);
      try {
        const token = localStorage.getItem('token');
        const apiUrl = process.env.REACT_APP_API_URL || '';
        const id = attachment.qc_id ?? attachment.id;
        const fileName = attachment.qc_file_name ?? attachment.file_name;

        let res;
        let correctMime = attachment.qc_mime_type || 'application/octet-stream';
        try {
          const urlRes = await fetch(`${apiUrl}/api/v1/qc/patient/view-url/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!urlRes.ok) throw new Error('view-url not available');
          const { view_url, mime_type: serverMime } = await urlRes.json();
          if (serverMime) correctMime = serverMime;
          res = await fetch(view_url);
          if (!res.ok) throw new Error('signed url fetch failed');
        } catch {
          res = await fetch(`${apiUrl}/api/v1/qc/patient/view-file/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || `Server error (${res.status})`);
          }
          correctMime = res.headers.get('content-type') || correctMime;
        }

        const fileType = getFileType(fileName, correctMime);
        if (cancelled) return;

        if (fileType === 'docx') {
          const arrayBuffer = await res.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(result.value);
          setMeta({ fileSizeBytes: arrayBuffer.byteLength, format: 'DOCX' });
          setStatus('docx');
          return;
        }

        const rawBlob = await res.blob();
        const typedBlob = new Blob([rawBlob], { type: correctMime });
        createdUrl = URL.createObjectURL(typedBlob);
        setBlobUrl(createdUrl);
        setMeta({ fileSizeBytes: typedBlob.size, format: fileType === 'pdf' ? 'PDF' : fileType === 'image' ? 'Image' : (correctMime || 'Unknown') });
        setStatus(fileType);
      } catch (err) {
        console.error('Failed to load report attachment', err);
        if (!cancelled) { setErrorMsg(err.message); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
  }, [attachment]);

  return { status, blobUrl, docxHtml, meta, errorMsg };
}
