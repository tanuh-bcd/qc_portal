export const apiUrl = process.env.REACT_APP_API_URL || '';
export const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export async function apiPost(path, body) {
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

export async function fetchSessionDetail(sessionId) {
  const res = await fetch(`${apiUrl}/api/v1/qc/doctor/sessions/${sessionId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load case (${res.status})`);
  return res.json();
}
