import { useEffect, useRef } from 'react';
// Small fetch helpers shared by the retrospective admin components.
export const API = `${process.env.REACT_APP_API_URL || ''}/api/v1/qc/retro`;
export const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const parse = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
  return body;
};
export const deleteJson = async (path) => parse(await fetch(`${API}${path}`, { method: 'DELETE', headers: authHeaders() }));
export const getJson = async (path) => parse(await fetch(`${API}${path}`, { headers: authHeaders() }));
export const postJson = async (path, payload) => parse(await fetch(`${API}${path}`, {
  method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}));

export const STATUS = {
  unassigned: ['Unassigned', 'st-none'], awaiting: ['Awaiting', 'st-wait'], in_progress: ['In progress', 'st-prog'],
  with_radiologist: ['With radiologist', 'st-rad'], radiologist_in_progress: ['Radiologist in progress', 'st-radprog'],
  segmented: ['Segmented', 'st-done'], rejected: ['Rejected by Radiologist', 'st-rej'],
};
export const STATUS_ORDER = ['awaiting', 'in_progress', 'with_radiologist', 'radiologist_in_progress', 'segmented', 'rejected'];
export const isAssignable = (c) => c.status === 'unassigned' || c.status === 'awaiting';   // awaiting = not opened yet, so it can still be moved

// Poll a loader, but not while the browser tab is hidden, and catch up as soon as it is shown again.
// Every poll is a round trip to the database, so a page left open in a background tab should not keep hammering it.
export const usePoll = (fn, ms) => {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => { if (!document.hidden) ref.current(); };
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [ms]);
};
