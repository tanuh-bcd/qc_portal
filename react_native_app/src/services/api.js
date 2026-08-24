const API_URL = __DEV__ ? 'http://10.0.2.2:8000' : 'https://your-production-api.com';

export async function startRemoteSession() {
  const res = await fetch(`${API_URL}/api/session/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`Session start failed: ${res.status}`);
  return res.json();
}

export async function submitRemoteQuestionnaire(sessionId, formDataEn) {
  const res = await fetch(`${API_URL}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, formDataEn }),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
  return res.json();
}

export async function uploadConsentPhoto(sessionId, photoPath, token) {
  const formData = new FormData();
  formData.append('file', {
    uri: photoPath,
    type: 'image/jpeg',
    name: `consent_${sessionId}.jpg`,
  });

  const res = await fetch(`${API_URL}/api/v1/patient/consent`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`Consent upload failed: ${res.status}`);
  return res.json();
}

export async function fetchHospitals() {
  const res = await fetch(`${API_URL}/api/v1/auth/hospitals`);
  if (!res.ok) throw new Error(`Fetch hospitals failed: ${res.status}`);
  return res.json();
}

export { API_URL };
