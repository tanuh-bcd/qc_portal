import React, { useState } from 'react';
import ResumableUpload from './ResumableUpload';
import { Plus, Eye } from 'lucide-react';

const DOC_CATEGORIES = [
  { value: 'additional_histopathology', label: 'Histopathology Report' },
  { value: 'additional_ihc', label: 'IHC Report' },
  { value: 'additional_prior_imaging', label: 'Prior Breast Imaging Report' },
  { value: 'additional_mammo_views', label: 'Additional Mammography Views' },
  { value: 'additional_other_imaging', label: 'Other Imaging Report' },
];

function getCategoryLabel(fileType) {
  for (const cat of DOC_CATEGORIES) {
    if (fileType.startsWith(cat.value)) return cat.label;
  }
  return 'Document';
}

const AdditionalDocs = ({ sessionId, existingAttachments = [], onView, readOnly = false }) => {
  const [slots, setSlots] = useState([]);

  const nextSuffix = (prefix) => {
    const allKeys = [
      ...existingAttachments.map(a => a.file_type),
      ...slots.map(s => s.fileType),
    ].filter(k => k.startsWith(prefix));
    const nums = allKeys.map(k => {
      const last = k.split('_').pop();
      return parseInt(last, 10);
    }).filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  };

  const addSlot = () => {
    const defaultCat = DOC_CATEGORIES[0].value;
    setSlots(prev => [
      ...prev,
      { id: Date.now(), category: defaultCat, fileType: `${defaultCat}_${nextSuffix(defaultCat)}` },
    ]);
  };

  const updateCategory = (slotId, newCategory) => {
    setSlots(prev => prev.map(s =>
      s.id === slotId
        ? { ...s, category: newCategory, fileType: `${newCategory}_${nextSuffix(newCategory)}` }
        : s
    ));
  };

  return (
    <div>
      {existingAttachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {existingAttachments.map(att => (
            <div key={att.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 8,
              background: '#e8f7f8', border: '1px solid #c8e0e2',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#14868C', minWidth: 160 }}>
                {getCategoryLabel(att.file_type)}
              </span>
              <span style={{
                flex: 1, fontSize: 12, color: '#333',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {att.file_name}
              </span>
              {onView && (
                <button
                  type="button"
                  onClick={() => onView(att)}
                  style={{
                    background: 'none', border: '1px solid #14868C', borderRadius: 4,
                    color: '#14868C', cursor: 'pointer', padding: '2px 6px',
                    display: 'flex', alignItems: 'center', gap: 3,
                    fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: 'inherit',
                  }}
                >
                  <Eye size={12} /> View
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && slots.map(slot => (
        <div key={slot.id} style={{
          marginBottom: 12, padding: 12, borderRadius: 10,
          border: '1.5px dashed #c8e0e2', background: '#fafefe',
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' }}>
              Document Type
            </label>
            <select
              value={slot.category}
              onChange={(e) => updateCategory(slot.id, e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid #d0d7de', fontSize: 13, background: '#fff',
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {DOC_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <ResumableUpload
            label="Upload File"
            hint=".pdf, images, .dcm"
            accept=".pdf,image/*,.dcm,application/dicom"
            fileType={slot.fileType}
            sessionId={sessionId}
            existing={null}
          />
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={addSlot}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 8,
            border: '1.5px dashed #14868C', background: '#fafefe',
            color: '#14868C', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit', width: '100%',
            justifyContent: 'center',
          }}
        >
          <Plus size={15} />
          Add Document
        </button>
      )}

      {readOnly && existingAttachments.length === 0 && (
        <div style={{ fontSize: 12, color: '#999' }}>No additional documents uploaded</div>
      )}
    </div>
  );
};

export default AdditionalDocs;
