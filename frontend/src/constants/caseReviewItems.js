export const VIEW_TYPES = [
  { key: 'mammo_cc_left', proj: 'CC', side: 'Left' },
  { key: 'mammo_mlo_left', proj: 'MLO', side: 'Left' },
  { key: 'mammo_cc_right', proj: 'CC', side: 'Right' },
  { key: 'mammo_mlo_right', proj: 'MLO', side: 'Right' },
  { key: 'mammo_reading', proj: 'Mammography Report', side: '', isReport: true },
];

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
export const GRADES = ['Best', 'Good', 'Bad', 'Not a Mammogram'];
export const REASON_REQUIRED_GRADES = ['Bad', 'Not a Mammogram'];
export const EMPTY_SIDE = { birads: '', birads_4_sub: '', density: '' };

export const fmtBytes = (bytes) => {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
