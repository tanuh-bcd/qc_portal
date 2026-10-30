import React, { useCallback, useEffect, useState } from 'react';
import RetroCaseViewer, { fmtDate } from './RetroCaseViewer';
import { getJson, deleteJson } from './retroApi';

// Cases the Radiologist rejected (no lesion). Admin can view and delete; nothing here can be downloaded.
const RetroRejectedCases = ({ onChanged }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    try { setRows((await getJson('/cases?status=rejected&page_size=200&order=desc')).items); setMsg(null); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.case_code} permanently?\n\nIts files are removed from storage and the database. The rejected count on the dashboard stays. This cannot be undone.`)) return;
    try { await deleteJson(`/cases/${c.id}`); setMsg({ ok: true, text: `${c.case_code} deleted.` }); load(); onChanged && onChanged(); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <div className="ri-page">
    <header className="ri-hero">
      <div>
        <span className="ri-eyebrow">Retrospective study</span>
        <h2>Cases rejected by Radiologist</h2>
        <p>These passed the upload checks, but a Radiologist found no lesion to segment. They never return to a Mammo Tech.</p>
      </div>
    </header>
    <section className="ri-card" style={{ marginTop: 16 }}>
      <h3>Rejected cases <span className="ri-count bad">{rows.length}</span></h3>
      <p className="ri-muted" style={{ margin: '4px 0 12px' }}>Deleting a case removes it from storage and the database. It stays in the rejected count on the dashboard.</p>
      {msg && <p className={msg.ok ? 'ri-okmsg' : 'ri-error'}>{msg.text}</p>}
      <div className="ri-scroll">
        <table className="ri-table">
          <thead><tr><th>Case</th><th>Original name</th><th>BI-RADS</th><th>Density</th><th>Manufacturer</th><th>Vendor</th><th>Uploaded</th><th>Mammo Tech</th><th>Radiologist</th><th>Reason</th><th>Rejected</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan="12" className="ri-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan="12" className="ri-empty">No cases have been rejected by a Radiologist.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong className="ri-code">{c.case_code}</strong></td>
                <td>{c.original_name}</td>
                <td>{c.birads || '–'}</td>
                <td>{c.density || '–'}</td>
                <td>{c.manufacturer || '–'}</td>
                <td>{c.vendor || '–'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.created_at ? fmtDate(c.created_at) : '–'}</td>
                <td>{c.assignment?.mammo_tech_name || '–'}</td>
                <td>{c.assignment?.rejected_by || c.assignment?.radiologist_name || '–'}</td>
                <td><div className="ri-reason">{c.assignment?.reject_reason || '–'}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.assignment?.rejected_at ? fmtDate(c.assignment.rejected_at) : '–'}</td>
                <td className="ri-actions">
                  <button className="ri-view" onClick={() => setViewing(c.id)}>View</button>
                  <button className="ri-view del" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && <RetroCaseViewer caseId={viewing} onClose={() => setViewing(null)} />}
    </section>
    </div>
  );
};

export default RetroRejectedCases;
