import React, { useState } from 'react';
import ResumableUpload from './ResumableUpload';
import { Plus } from 'lucide-react';

const MultiUpload = ({ label, hint, accept, fileTypePrefix, sessionId, existingAttachments = [], onView }) => {
  const [slots, setSlots] = useState(() => {
    if (existingAttachments.length > 0) {
      return existingAttachments.map(att => ({
        fileType: att.file_type,
        existing: att,
      }));
    }
    return [];
  });

  const nextSuffix = () => {
    const nums = slots
      .map(s => {
        const parts = s.fileType.split('_');
        const last = parts[parts.length - 1];
        return parseInt(last, 10);
      })
      .filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  };

  const addSlot = () => {
    setSlots(prev => [
      ...prev,
      { fileType: `${fileTypePrefix}_${nextSuffix()}`, existing: null },
    ]);
  };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{hint}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {slots.map((slot, idx) => (
          <ResumableUpload
            key={slot.fileType}
            label={`${label} #${idx + 1}`}
            hint={accept}
            accept={accept}
            fileType={slot.fileType}
            sessionId={sessionId}
            existing={slot.existing}
            onView={onView}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addSlot}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: slots.length > 0 ? 8 : 0,
          padding: '8px 14px', borderRadius: 8,
          border: '1.5px dashed #14868C', background: '#fafefe',
          color: '#14868C', fontWeight: 600, fontSize: 12,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Plus size={14} />
        Add {label}
      </button>
    </div>
  );
};

export default MultiUpload;
