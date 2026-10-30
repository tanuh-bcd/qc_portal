import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RetroCaseViewer, { downloadMasksZip, fmtDate } from './RetroCaseViewer';
import { getJson, postJson, deleteJson, usePoll, STATUS, STATUS_ORDER, isAssignable } from './retroApi';

const PAGE_SIZE = 50;
const BIRADS = ['3', '4', '5', '6'];
const BIRADS_COLORS_CLASS = (b) => (b ? `ri-tag b${b[0]}` : '');
const openCount = (t) => Object.entries(t.counts || {}).reduce((n, [k, v]) => (k === 'segmented' ? n : n + v), 0);

// The one place cases are assigned: filter, tick, then use the action bar.
const RetroCasesTable = ({ tally, techs, statusFilter, setStatusFilter, reloadKey, onChanged }) => {
  const [data, setData] = useState({ items: [], total: 0, assignable_total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [birads, setBirads] = useState('');
  const [vendorF, setVendorF] = useState('');
  const [manufacturerF, setManufacturerF] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [facets, setFacets] = useState({ vendors: [], manufacturers: [] });
  const [selected, setSelected] = useState([]);     // explicit case ids, kept across pages
  const [allMatching, setAllMatching] = useState(false);
  const [bulkTech, setBulkTech] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [undo, setUndo] = useState(null);
  const [viewing, setViewing] = useState(null);
  const lastIndex = useRef(null);
  const undoTimer = useRef(null);

  const filterBody = useMemo(() => ({
    q: search, birads: birads || null, status: statusFilter || null, mammo_tech_id: techFilter ? Number(techFilter) : null,
    vendor: vendorF || null, manufacturer: manufacturerF || null,
  }), [search, birads, statusFilter, techFilter, vendorF, manufacturerF]);

  const query = useCallback(() => {
    const p = new URLSearchParams({ page, page_size: PAGE_SIZE, order: 'asc' });
    Object.entries(filterBody).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [page, filterBody]);

  const load = useCallback(() => getJson(`/cases?${query()}`).then(setData).catch(() => {}), [query]);
  useEffect(() => { load(); }, [load, reloadKey]);
  usePoll(load, 20000);
  useEffect(() => { getJson('/case-facets').then(setFacets).catch(() => {}); }, [reloadKey]);

  // a different filter means a different list: start again from page 1 with nothing ticked
  useEffect(() => { setPage(1); setSelected([]); setAllMatching(false); setConfirming(false); lastIndex.current = null; },
    [search, birads, statusFilter, techFilter, vendorF, manufacturerF]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const deleteCase = async (c) => {
    if (!window.confirm(`Delete ${c.case_code} permanently?\n\nIts files are removed from storage and the database. The rejected count on the dashboard stays. This cannot be undone.`)) return;
    try { await deleteJson(`/cases/${c.id}`); setMsg({ ok: true, text: `${c.case_code} deleted.` }); load(); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const pageAssignable = data.items.filter(isAssignable);
  const pageAllTicked = pageAssignable.length > 0 && pageAssignable.every((c) => selected.includes(c.id));
  const count = allMatching ? data.assignable_total : selected.length;
  const tech = techs.find((t) => String(t.id) === String(bulkTech));
  const changed = () => { load(); onChanged && onChanged(); };

  const tickRow = (index, c, shift) => {
    if (!isAssignable(c)) return;
    setAllMatching(false); setConfirming(false);
    if (shift && lastIndex.current !== null) {          // shift-click: tick the whole stretch
      const [a, b] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      const ids = data.items.slice(a, b + 1).filter(isAssignable).map((x) => x.id);
      setSelected((cur) => Array.from(new Set([...cur, ...ids])));
    } else {
      setSelected((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]));
    }
    lastIndex.current = index;
  };
  const tickPage = () => {
    setAllMatching(false); setConfirming(false);
    const ids = pageAssignable.map((c) => c.id);
    setSelected((cur) => (pageAllTicked ? cur.filter((x) => !ids.includes(x)) : Array.from(new Set([...cur, ...ids]))));
  };
  const clear = () => { setSelected([]); setAllMatching(false); setConfirming(false); };

  const describe = (b) => [
    b.assigned ? `Assigned ${b.assigned} case(s) to ${b.mammo_tech}.` : '',
    b.moved ? `Moved ${b.moved} case(s) to ${b.mammo_tech}.` : '',
    b.already_assigned?.length ? `${b.already_assigned.length} already had this Mammo Tech.` : '',
    b.locked?.length ? `${b.locked.length} could not move because the Mammo Tech already opened them.` : '',
    b.not_found ? `${b.not_found} not found.` : '',
  ].filter(Boolean).join(' ') || 'Nothing to change.';

  const doAssign = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = await postJson('/assign', allMatching
        ? { mammo_tech_id: Number(bulkTech), matching: filterBody, expected_count: data.assignable_total, reassign: true }
        : { mammo_tech_id: Number(bulkTech), case_ids: selected, reassign: true });
      setMsg({ ok: !body.locked?.length, text: describe(body) });
      clearTimeout(undoTimer.current);
      if (body.assigned || body.moved) {
        setUndo({ name: body.mammo_tech, given: body.assigned_ids || [], movedFrom: body.moved_from || {} });
        undoTimer.current = setTimeout(() => setUndo(null), 10000);
      }
      clear(); changed();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false); setConfirming(false);
  };

  const doUnassign = async () => {
    const ids = data.items.filter((c) => selected.includes(c.id) && c.status === 'awaiting').map((c) => c.id);
    if (!ids.length) return;
    setBusy(true); setMsg(null);
    try {
      const body = await postJson('/unassign', ids);
      setMsg({ ok: true, text: `Unassigned ${body.unassigned} case(s).` });
      clear(); changed();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };

  const doUndo = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      if (undo.given.length) await postJson('/unassign', undo.given);
      const byTech = {};
      Object.entries(undo.movedFrom).forEach(([caseId, techId]) => { (byTech[techId] = byTech[techId] || []).push(Number(caseId)); });
      for (const [techId, ids] of Object.entries(byTech)) await postJson('/assign', { mammo_tech_id: Number(techId), case_ids: ids, reassign: true });
      setMsg({ ok: true, text: 'Undone. The cases are back where they were.' });
    } catch (e) { setMsg({ ok: false, text: `Could not undo: ${e.message}` }); }
    clearTimeout(undoTimer.current); setUndo(null); setBusy(false); changed();
  };

  const from = data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, data.total);

  return (
    <>
      <section className="ri-card">
        <h3>Mammo Tech workload <span className="ri-count">{tally?.by_status?.unassigned ?? 0} unassigned</span></h3>
        <p className="ri-muted ri-hint">To assign: filter the list below, tick the cases, choose a Mammo Tech in the bar that appears, and press Assign. Click a person here to see only their cases.</p>
        {techs.length === 0 && <p className="ri-muted">No active Mammo Tech users found.</p>}
        <div className="ri-techs">
          {techs.map((t) => (
            <button key={t.id} className={`ri-tech ${String(techFilter) === String(t.id) ? 'on' : ''}`} onClick={() => setTechFilter(String(techFilter) === String(t.id) ? '' : String(t.id))} title="Show only this person's cases">
              <div className="ri-tech-head"><b>{t.name}</b><span>{t.total} case(s)</span></div>
              <div className="ri-stack">
                {STATUS_ORDER.map((k) => (t.counts[k] ? <i key={k} className={STATUS[k][1]} style={{ flex: t.counts[k] }} title={`${STATUS[k][0]}: ${t.counts[k]}`} /> : null))}
              </div>
              <div className="ri-tech-legend">
                {STATUS_ORDER.map((k) => <span key={k}><i className={STATUS[k][1]} />{STATUS[k][0]} {t.counts[k] || 0}</span>)}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="ri-card" id="ri-cases">
        <div className="ri-row">
          <h3>Passed cases <span className="ri-count">{data.total}</span></h3>
          <input className="ri-search" placeholder="Search case, file, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ri-filters ri-statusrow">
          {['', 'unassigned', ...STATUS_ORDER].map((k) => (
            <button key={k || 'all'} className={`ri-pill ${statusFilter === k ? 'on' : ''}`} onClick={() => setStatusFilter(k)}>
              {k ? STATUS[k][0] : 'All statuses'}{k && tally?.by_status ? ` · ${tally.by_status[k] ?? 0}` : ''}
            </button>
          ))}
        </div>
        <div className="ri-filters ri-statusrow">
          {['', ...BIRADS].map((b) => (
            <button key={b || 'all'} className={`ri-pill ${birads === b ? 'on' : ''}`} onClick={() => setBirads(b)}>{b ? `BI-RADS ${b}` : 'All BI-RADS'}</button>
          ))}
          <select className="ri-rowselect" value={vendorF} onChange={(e) => setVendorF(e.target.value)}>
            <option value="">All vendors</option>{facets.vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="ri-rowselect" value={manufacturerF} onChange={(e) => setManufacturerF(e.target.value)}>
            <option value="">All manufacturers</option>{facets.manufacturers.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {techFilter && <button className="ri-pill on" onClick={() => setTechFilter('')}>{techs.find((t) => String(t.id) === techFilter)?.name} ✕</button>}
        </div>

        {pageAllTicked && !allMatching && data.assignable_total > selected.length && (
          <div className="ri-selbanner">
            All {pageAssignable.length} assignable cases on this page are selected.
            <button className="ri-link" onClick={() => setAllMatching(true)}>Select all {data.assignable_total} that match these filters</button>
          </div>
        )}
        {allMatching && (
          <div className="ri-selbanner">All {data.assignable_total} cases that match these filters are selected. <button className="ri-link" onClick={clear}>Clear</button></div>
        )}
        {msg && <p className={msg.ok ? 'ri-okmsg' : 'ri-error'}>{msg.text}</p>}

        <div className="ri-scroll">
          <table className="ri-table ri-cases">
            <thead>
              <tr>
                <th><input type="checkbox" title="Select the assignable cases on this page" checked={pageAllTicked || allMatching} disabled={!pageAssignable.length} onChange={tickPage} /></th>
                <th>Case</th><th>Original name</th><th>Modality</th><th>BI-RADS</th><th>Density</th><th>Manufacturer</th><th>Vendor</th><th>Uploaded</th><th>Assigned to</th><th>Status</th><th>Annotation</th><th />
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan="13" className="ri-empty">No cases match. Upload a folder or zip, or change the filters.</td></tr>}
              {data.items.map((c, i) => {
                const can = isAssignable(c);
                const ticked = allMatching ? can : selected.includes(c.id);
                return (
                  <tr key={c.id} className={ticked ? 'ri-ticked' : ''} onDoubleClick={() => setViewing(c.id)}>
                    <td>
                      <input type="checkbox" checked={!!ticked} disabled={!can} readOnly
                        title={can ? 'Shift-click to select a stretch of rows' : 'The Mammo Tech has already opened this case, so it can no longer be moved'}
                        onClick={(e) => tickRow(i, c, e.shiftKey)} onChange={() => {}} />
                    </td>
                    <td><strong className="ri-code">{c.case_code}</strong></td>
                    <td>{c.original_name}</td>
                    <td><span className="ri-tag dr">{c.modality}</span></td>
                    <td>{c.birads ? <span className={BIRADS_COLORS_CLASS(c.birads)}>{c.birads}</span> : '–'}</td>
                    <td>{c.density ? <span className="ri-tag dens">{c.density}</span> : '–'}</td>
                    <td>{c.manufacturer || '–'}</td>
                    <td>{c.vendor || '–'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.created_at ? fmtDate(c.created_at) : '–'}</td>
                    <td>{c.assignment ? (
                      <div className="ri-anno" title={can ? '' : 'Already opened, so it can no longer be moved'}>
                        <b style={{ color: 'inherit' }}>{can ? '' : '🔒 '}{c.assignment.mammo_tech_name}</b>
                        {c.assignment.radiologist_name && <span>↳ {c.assignment.radiologist_name}</span>}
                      </div>
                    ) : <span className="ri-muted">–</span>}</td>
                    <td>
                      <span className={`ri-status ${STATUS[c.status]?.[1]}`} title={c.assignment?.escalation_note || ''}>{c.status_label}</span>
                      {c.status === 'rejected' && c.assignment?.reject_reason && <div className="ri-reason">Rejected by Radiologist: {c.assignment.reject_reason}</div>}
                    </td>
                    <td>
                      {c.annotation?.done ? (
                        <div className="ri-anno"><b>✓ Done</b><span>by {c.annotation.by}</span><span>{c.annotation.views.join(', ')} · {fmtDate(c.annotation.at)}</span></div>
                      ) : c.annotation?.draft ? (
                        <div className="ri-anno"><b style={{ color: '#96600a' }}>Draft</b><span>{c.annotation.views.join(', ')} by {c.annotation.by}</span></div>
                      ) : <span className="ri-muted">Not done</span>}
                    </td>
                    <td className="ri-actions">
                      <button className="ri-view" onClick={() => setViewing(c.id)}>View</button>
                      {c.status === 'rejected' && <button className="ri-view del" title="Delete this case from the database and storage. The rejected count stays on the dashboard." onClick={() => deleteCase(c)}>Delete</button>}
                      {c.status !== 'rejected' && (c.annotation?.done || c.annotation?.draft || c.radiologist_views?.length > 0) && <button className="ri-view dl" title="Download masks (zip)" onClick={() => downloadMasksZip(c.id, c.case_code)}>⬇ Masks</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="ri-pager">
          <span>{data.total ? `Showing ${from}–${to} of ${data.total}` : 'No cases'}</span>
          <button className="ri-pill" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span>Page {page} of {pages}</span>
          <button className="ri-pill" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>

        {count > 0 && (
          <div className="ri-actionbar">
            <b>{count} selected</b>
            <select value={bulkTech} onChange={(e) => { setBulkTech(e.target.value); setConfirming(false); }}>
              <option value="">Assign to…</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name} · {openCount(t)} open</option>)}
            </select>
            {!confirming ? (
              <button className="ri-btn" disabled={!bulkTech || busy} onClick={() => setConfirming(true)}>Assign {count} case{count > 1 ? 's' : ''}</button>
            ) : (
              <>
                <span className="ri-confirm">Assign {count} case{count > 1 ? 's' : ''} to <b>{tech?.name}</b>?</span>
                <button className="ri-btn" disabled={busy} onClick={doAssign}>{busy ? 'Assigning…' : 'Confirm'}</button>
                <button className="ri-link" onClick={() => setConfirming(false)}>Cancel</button>
              </>
            )}
            {!allMatching && data.items.some((c) => selected.includes(c.id) && c.status === 'awaiting') && (
              <button className="ri-link" disabled={busy} onClick={doUnassign}>Unassign</button>
            )}
            <button className="ri-link" onClick={clear}>Clear</button>
          </div>
        )}
        {undo && count === 0 && (
          <div className="ri-actionbar ri-undobar">
            <span>Assigned to {undo.name}.</span>
            <button className="ri-btn" disabled={busy} onClick={doUndo}>Undo</button>
            <span className="ri-muted">available for 10 seconds</span>
          </div>
        )}
      </section>
      {viewing && <RetroCaseViewer caseId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
};

export default RetroCasesTable;
