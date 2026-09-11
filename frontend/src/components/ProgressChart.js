import React from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer } from 'recharts';

// Matches the status badge colors already used in MammoTechPage.js/RadiologistPage.js
// so a status reads the same color everywhere in the app.
export const STATUS_COLORS = {
  Pending: '#b0691c',
  'In-Progress': '#1c5f8f',
  Completed: '#1e7e4b',
  Rejected: '#9f1c1c',
};

const STATUS_ORDER = ['Pending', 'In-Progress', 'Rejected', 'Completed'];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const { status, count } = payload[0].payload;
  return (
    <div style={tooltipStyle}>
      <span style={{ color: STATUS_COLORS[status] || '#333', fontWeight: 700 }}>{status}</span>
      <span style={{ marginLeft: 8, color: '#52514e' }}>{count}</span>
    </div>
  );
};

const ProgressChart = ({ title, counts }) => {
  const data = STATUS_ORDER
    .filter((status) => Object.prototype.hasOwnProperty.call(counts || {}, status))
    .map((status) => ({ status, count: counts[status] }));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      {total === 0 ? (
        <p style={emptyStyle}>No cases yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, data.length * 56)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="#e1e0d9" />
            <XAxis type="number" allowDecimals={false} tick={{ fill: '#898781', fontSize: 12 }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
            <YAxis type="category" dataKey="status" width={90} tick={{ fill: '#52514e', fontSize: 13, fontWeight: 600 }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="count" barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status] || '#546e7a'} />
              ))}
              <LabelList dataKey="count" position="right" style={{ fill: '#52514e', fontSize: 13, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default ProgressChart;

const cardStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e1e0d9',
  borderRadius: 10,
  padding: '18px 20px',
  marginBottom: 20,
};

const titleStyle = {
  margin: '0 0 12px',
  fontSize: 15,
  fontWeight: 700,
  color: '#14868C',
};

const emptyStyle = {
  color: '#898781',
  fontSize: 13,
  margin: 0,
};

const tooltipStyle = {
  background: '#fff',
  border: '1px solid #e1e0d9',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
};
