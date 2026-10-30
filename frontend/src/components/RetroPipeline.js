import React, { useState } from 'react';
import './RetroPipeline.css';

// What each role sees as "their" pipeline. `key` ties a step to a status filter; `who` says who acts on it.
const PIPELINES = {
  admin: {
    title: 'Admin pipeline',
    intro: 'You upload cases, the system checks them, you assign ranges to Mammo Techs, then you watch every case move to Segmented. You only read cases; you never edit masks or notes.',
    steps: [
      { id: 'upload', title: 'Upload folder / zip', who: 'Admin', text: 'Drop a folder or zip with the vendor name', count: (c) => c.received },
      { id: 'checks', title: 'Automatic checks', who: 'System', text: '4 DR views, PDF with BI-RADS 3-6, no duplicates', count: (c) => c.rejected, label: 'rejected', tone: 'bad' },
      { id: 'unassigned', key: 'unassigned', title: 'Stored, unassigned', who: 'Admin', text: 'Passed cases waiting for you to assign a range' },
      { id: 'awaiting', key: 'awaiting', title: 'Awaiting', who: 'Mammo Tech', text: 'Assigned; not opened yet' },
      { id: 'in_progress', key: 'in_progress', title: 'In progress', who: 'Mammo Tech', text: 'Segmenting the lesion per view' },
      { id: 'with_radiologist', key: 'with_radiologist', title: 'With radiologist', who: 'Radiologist', text: 'Mammo Tech unsure; waiting for the radiologist' },
      { id: 'radiologist_in_progress', key: 'radiologist_in_progress', title: 'Radiologist in progress', who: 'Radiologist', text: 'Marking the lesion and writing notes' },
      { id: 'segmented', key: 'segmented', title: 'Segmented', who: 'Mammo Tech', text: 'Annotation done. Download the masks', tone: 'ok' },
    ],
  },
  mammo_tech: {
    title: 'Mammo Tech pipeline',
    intro: 'Open an assigned case, draw the lesion on each view and save. If you are not sure it is a lesion, send it to a Radiologist with a note. When they return it, finish the segmentation using their mask and notes.',
    steps: [
      { id: 'awaiting', key: 'awaiting', title: 'Awaiting', who: 'You', text: 'Assigned by the admin. Open one to start' },
      { id: 'in_progress', key: 'in_progress', title: 'In progress', who: 'You', text: 'Draw and save a mask per view, add notes' },
      { id: 'with_radiologist', key: 'with_radiologist', title: 'With radiologist', who: 'Radiologist', text: 'You were unsure. Waiting for their review', merge: ['radiologist_in_progress'] },
      { id: 'returned', title: 'Returned to you', who: 'You', text: 'Radiologist mask and notes are on the case', count: (c) => c.returned },
      { id: 'segmented', key: 'segmented', title: 'Segmented', who: 'You', text: 'You pressed Finish. Admin can download', tone: 'ok' },
    ],
  },
  radiologist: {
    title: 'Radiologist pipeline',
    intro: 'Cases appear when a Mammo Tech is unsure about a lesion. Open one, mark where the lesion is with the same tool, write your clinical notes, then complete the review to send it back to the Mammo Tech.',
    steps: [
      { id: 'with_radiologist', key: 'with_radiologist', title: 'Waiting for you', who: 'You', text: 'Sent by a Mammo Tech with a note about the doubt' },
      { id: 'radiologist_in_progress', key: 'radiologist_in_progress', title: 'In progress', who: 'You', text: 'Mark the lesion; write clinical notes' },
      { id: 'returned', key: 'returned', title: 'Returned to Mammo Tech', who: 'Mammo Tech', text: 'You completed the review; they finish the segmentation', tone: 'ok', count: (c) => c.returned },
    ],
  },
};

const RetroPipeline = ({ role, counts = {}, extra = {}, active = '', onSelect, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  const def = PIPELINES[role];
  if (!def) return null;
  const all = { ...extra, ...counts };
  return (
    <section className="rp">
      <button className="rp-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="rp-title">{def.title}</span>
        <span className="rp-toggle">{open ? 'Hide' : 'Show how it works'}</span>
      </button>
      {open && (
        <>
          <p className="rp-intro">{def.intro}</p>
          <ol className="rp-steps">
            {def.steps.map((s, i) => {
              const n = s.count ? s.count(all) : (all[s.key] || 0) + (s.merge || []).reduce((t, k) => t + (all[k] || 0), 0);
              const clickable = !!(s.key && onSelect);
              return (
                <li key={s.id} className={`rp-step ${s.tone || ''} ${active && active === s.key ? 'active' : ''} ${n ? 'has' : ''}`}>
                  <button disabled={!clickable} onClick={() => onSelect(active === s.key ? '' : s.key)} title={clickable ? 'Filter the list' : ''}>
                    <span className="rp-num">{i + 1}</span>
                    <span className="rp-n">{n ?? 0}{s.label ? <small>{s.label}</small> : null}</span>
                    <b>{s.title}</b>
                    <em className={`rp-who who-${s.who.toLowerCase().replace(/\s+/g, '-')}`}>{s.who}</em>
                    <span className="rp-text">{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
};

export default RetroPipeline;
