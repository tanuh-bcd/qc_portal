// Shared fetch-with-fallback for attachment bytes: prefer a GCS signed URL,
// fall back to the backend proxy (/view-file). If signed-URL generation is
// known to be broken in this environment (e.g. missing IAM signBlob
// permission), every load would otherwise pay for one doomed request before
// falling back — so once it fails once in this browser tab, every
// subsequent call skips straight to the proxy for the rest of the session.
let signedUrlUnavailable = false;

export function isSignedUrlUnavailable() {
  return signedUrlUnavailable;
}

export function markSignedUrlUnavailable() {
  signedUrlUnavailable = true;
}

export async function fetchAttachment(id, token, apiUrl = process.env.REACT_APP_API_URL || '') {
  if (!signedUrlUnavailable) {
    try {
      const urlRes = await fetch(`${apiUrl}/api/v1/qc/patient/view-url/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!urlRes.ok) throw new Error('view-url not available');
      const { view_url, mime_type: mimeType } = await urlRes.json();
      const res = await fetch(view_url);
      if (!res.ok) throw new Error('signed url fetch failed');
      return { res, mimeType: mimeType || null };
    } catch {
      signedUrlUnavailable = true;
    }
  }

  const res = await fetch(`${apiUrl}/api/v1/qc/patient/view-file/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Server error (${res.status})`);
  }
  return { res, mimeType: res.headers.get('content-type') || null };
}
