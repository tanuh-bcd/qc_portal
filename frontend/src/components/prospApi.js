import { authHeaders } from './retroApi';

export const PAPI = `${process.env.REACT_APP_API_URL || ''}/api/v1/qc/prospective`;

export const pget = async (path) => {
  const res = await fetch(`${PAPI}${path}`, { headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
  return body;
};

export const pdownload = async (path, filename) => {
  const res = await fetch(`${PAPI}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const qs = (obj) => Object.entries(obj).filter(([, v]) => v !== '' && v !== false && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v === true ? 'true' : v)}`).join('&');
export const fmtWhen = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–');
