import React from 'react';

// Kept in sync with Layout.js, which paints this same width/color as part of
// its own flex-row background — see the comment there for why.
export const SIDEBAR_WIDTH = 220;

// items: [{ id, label }]
const Sidebar = ({ items, activeId, onSelect }) => (
  <nav style={navStyle}>
    {items.map((item) => (
      <button
        key={item.id}
        onClick={() => onSelect(item.id)}
        style={{
          ...itemStyle,
          ...(activeId === item.id ? activeItemStyle : null),
        }}
      >
        {item.label}
      </button>
    ))}
  </nav>
);

const navStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignSelf: 'stretch',
  gap: 4,
  width: SIDEBAR_WIDTH,
  flexShrink: 0,
  padding: '20px 12px',
  backgroundColor: '#fff',
  borderRight: '1px solid #e1e0d9',
};

const itemStyle = {
  textAlign: 'left',
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'none',
  color: '#495057',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const activeItemStyle = {
  backgroundColor: '#DAF3F4',
  color: '#14868C',
  fontWeight: 700,
};

export default Sidebar;
