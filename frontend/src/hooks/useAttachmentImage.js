import { useEffect, useRef, useState } from 'react';
import dicomParser from 'dicom-parser';

/* ------------------------------------------------------------------
   Shared DICOM/image decode hook — same fetch chain + decode used by
   BreastCaseReviewPanel.jsx's tiles and DicomCaseViewer.js's full-screen
   view (view-url signed GCS link first, view-file backend proxy fallback;
   dicom-parser to read the header; manual windowing to canvas for
   uncompressed pixel data, or unwrap the JPEG/JPEG2000 fragment for
   compressed pixel data). Extracted so both consumers share one decoder
   instead of maintaining separate copies.
------------------------------------------------------------------- */
export default function useAttachmentImage(attachment) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState(attachment ? 'loading' : 'empty'); // loading | canvas | img | error | empty
  const [blobUrl, setBlobUrl] = useState(null);
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

        let res;
        try {
          const urlRes = await fetch(`${apiUrl}/api/v1/qc/patient/view-url/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!urlRes.ok) throw new Error('view-url not available');
          const { view_url } = await urlRes.json();
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
        }

        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const byteArray = new Uint8Array(buffer);
        const fileSizeBytes = buffer.byteLength;

        // Mislabeled non-DICOM files (.dcm extension but actually a plain image)
        if (byteArray[0] === 0xFF && byteArray[1] === 0xD8) {
          createdUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
          setBlobUrl(createdUrl);
          setMeta({ fileSizeBytes, format: 'JPEG' });
          setStatus('img');
          return;
        }
        if (byteArray[0] === 0x89 && byteArray[1] === 0x50) {
          createdUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
          setBlobUrl(createdUrl);
          setMeta({ fileSizeBytes, format: 'PNG' });
          setStatus('img');
          return;
        }

        const dataSet = dicomParser.parseDicom(byteArray);
        const rows = dataSet.uint16('x00280010');
        const cols = dataSet.uint16('x00280011');
        const bitsAllocated = dataSet.uint16('x00280100') || 16;
        const samplesPerPixel = dataSet.uint16('x00280002') || 1;
        const photometric = dataSet.string('x00280004') || 'MONOCHROME2';
        const transferSyntax = dataSet.string('x00020010') || '';
        const baseMeta = { rows, cols, bitsAllocated, samplesPerPixel, photometric, transferSyntax, fileSizeBytes };

        const pixelDataElement = dataSet.elements.x7fe00010;
        if (!pixelDataElement) throw new Error('No pixel data found in DICOM file');

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
          const isJp2 = transferSyntax.includes('1.2.840.10008.1.2.4.90') || transferSyntax.includes('1.2.840.10008.1.2.4.91');
          const mime = isJp2 ? 'image/jp2' : 'image/jpeg';
          createdUrl = URL.createObjectURL(new Blob([frameData], { type: mime }));
          setBlobUrl(createdUrl);
          setMeta({ ...baseMeta, compressed: true, format: isJp2 ? 'JPEG2000 (DICOM)' : 'JPEG (DICOM)' });
          setStatus('img');
          return;
        }

        if (!rows || !cols) throw new Error('Invalid DICOM dimensions');
        const bitsStored = dataSet.uint16('x00280101') || bitsAllocated;
        const pixelRepresentation = dataSet.uint16('x00280103') || 0;
        const wcStr = dataSet.string('x00281050');
        const wwStr = dataSet.string('x00281051');
        const windowCenter = wcStr ? parseFloat(wcStr.split('\\')[0]) : (1 << (bitsStored - 1));
        const windowWidth = wwStr ? parseFloat(wwStr.split('\\')[0]) : (1 << bitsStored);
        const offset = pixelDataElement.dataOffset;
        const buf = dataSet.byteArray.buffer;
        const bytesPerPixel = bitsAllocated === 16 ? 2 : 1;
        const expectedSize = rows * cols * (samplesPerPixel === 3 ? 3 : bytesPerPixel);
        if (offset + expectedSize > buf.byteLength) throw new Error('Pixel data truncated or corrupted');

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not ready');
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
              pv = pixelRepresentation === 1 ? pixelData.getInt16(i * 2, true) : pixelData.getUint16(i * 2, true);
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
        setMeta({ ...baseMeta, compressed: false, format: 'DICOM (raw)' });
        setStatus('canvas');
      } catch (err) {
        console.error('Failed to load/decode attachment image', err);
        if (!cancelled) { setErrorMsg(err.message); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
  }, [attachment]);

  return { canvasRef, status, blobUrl, meta, errorMsg };
}
