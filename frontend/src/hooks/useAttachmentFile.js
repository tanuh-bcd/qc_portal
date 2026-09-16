import { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import { fetchAttachment } from '../utils/attachmentFetch';

const getFileType = (fileName, mimeType) => {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext) || (mimeType && mimeType.startsWith('image/'))) return 'image';
  return 'unknown';
};

const loadedCache = new Map();

export default function useAttachmentFile(attachment) {
  const [status, setStatus] = useState(attachment ? 'loading' : 'empty');
  const [blobUrl, setBlobUrl] = useState(null);
  const [docxHtml, setDocxHtml] = useState(null);
  const [meta, setMeta] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!attachment) { setStatus('empty'); return; }
    const id = attachment.qc_id ?? attachment.id;

    const cached = loadedCache.get(id);
    if (cached) {
      setMeta(cached.meta);
      setErrorMsg(null);
      setBlobUrl(cached.blobUrl || null);
      setDocxHtml(cached.docxHtml || null);
      setStatus(cached.status);
      return;
    }

    let cancelled = false;
    let createdUrl = null;

    (async () => {
      setStatus('loading');
      setErrorMsg(null);
      try {
        const token = localStorage.getItem('token');
        const fileName = attachment.qc_file_name ?? attachment.file_name;
        let correctMime = attachment.qc_mime_type || 'application/octet-stream';

        const { res, mimeType } = await fetchAttachment(id, token);
        if (mimeType) correctMime = mimeType;

        const fileType = getFileType(fileName, correctMime);
        if (cancelled) return;

        if (fileType === 'docx') {
          const arrayBuffer = await res.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          const meta = { fileSizeBytes: arrayBuffer.byteLength, format: 'DOCX' };
          loadedCache.set(id, { status: 'docx', docxHtml: result.value, meta });
          setDocxHtml(result.value);
          setMeta(meta);
          setStatus('docx');
          return;
        }

        const rawBlob = await res.blob();
        const typedBlob = new Blob([rawBlob], { type: correctMime });
        createdUrl = URL.createObjectURL(typedBlob);
        const meta = { fileSizeBytes: typedBlob.size, format: fileType === 'pdf' ? 'PDF' : fileType === 'image' ? 'Image' : (correctMime || 'Unknown') };
        loadedCache.set(id, { status: fileType, blobUrl: createdUrl, meta });
        setBlobUrl(createdUrl);
        setMeta(meta);
        setStatus(fileType);
      } catch (err) {
        console.error('Failed to load report attachment', err);
        if (!cancelled) { setErrorMsg(err.message); setStatus('error'); }
      }
    })();

    // Cached blob URLs are intentionally kept alive for reuse rather than
    // revoked here — see the matching note in useAttachmentImage.js.
    return () => { cancelled = true; };
  }, [attachment]);

  return { status, blobUrl, docxHtml, meta, errorMsg };
}
