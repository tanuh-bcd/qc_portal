import { useEffect, useState } from 'react';

const decodedCache = new Map(); 
const inflight = new Map(); 
const cacheKey = (id, resolution) => `${id}:${resolution}`;

async function loadAttachmentImage(attachment, resolution) {
  const id = attachment.qc_id ?? attachment.id;
  const key = cacheKey(id, resolution);

  const cached = decodedCache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const token = localStorage.getItem('token');
    const apiUrl = process.env.REACT_APP_API_URL || '';
    const res = await fetch(`${apiUrl}/api/v1/qc/patient/view-file/${id}?resolution=${resolution}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `Server error (${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';
    const rows = res.headers.get('x-dicom-rows');
    const isDicom = rows !== null;
    const meta = {
      fileSizeBytes: 0, // filled in below once the body is read
      format: isDicom ? 'DICOM (converted)' : (contentType.includes('png') ? 'PNG' : 'JPEG'),
      ...(isDicom ? {
        rows: Number(rows) || null,
        cols: Number(res.headers.get('x-dicom-cols')) || null,
        bitsAllocated: Number(res.headers.get('x-dicom-bits-allocated')) || null,
        compressed: res.headers.get('x-dicom-compressed') === 'true',
      } : {}),
    };

    const buffer = await res.arrayBuffer();
    meta.fileSizeBytes = buffer.byteLength;
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: contentType || 'image/png' }));
    const entry = { blobUrl, meta };
    decodedCache.set(key, entry);
    return entry;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function prefetchAttachmentImage(attachment, resolution = 'screen') {
  if (!attachment) return;
  const id = attachment.qc_id ?? attachment.id;
  if (decodedCache.has(cacheKey(id, resolution)) || inflight.has(cacheKey(id, resolution))) return;
  loadAttachmentImage(attachment, resolution).catch(() => {
  });
}

export default function useAttachmentImage(attachment, resolution = 'screen') {
  const [status, setStatus] = useState(attachment ? 'loading' : 'empty'); // loading | img | error | empty
  const [blobUrl, setBlobUrl] = useState(null);
  const [meta, setMeta] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!attachment) { setStatus('empty'); return; }

    let cancelled = false;
    setStatus('loading');
    setErrorMsg(null);

    loadAttachmentImage(attachment, resolution).then(({ blobUrl, meta }) => {
      if (cancelled) return;
      setBlobUrl(blobUrl);
      setMeta(meta);
      setStatus('img');
    }).catch(err => {
      console.error('Failed to load attachment image', err);
      if (!cancelled) { setErrorMsg(err.message); setStatus('error'); }
    });

    return () => { cancelled = true; };
  }, [attachment, resolution]);

  return { status, blobUrl, meta, errorMsg };
}
