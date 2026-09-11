import React from 'react';
import './Sidebar.css';


export const SIDEBAR_WIDTH = 220;


const Sidebar = ({ items, activeId, onSelect, isOpen = false, onClose }) => {
  const handleSelect = (id) => {
    onSelect(id);
    onClose?.();
  };

  return (
    <>
      {isOpen && <div className="qc-sidebar-backdrop open" onClick={onClose} />}
      <nav className={`qc-sidebar${isOpen ? ' open' : ''}`}>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => handleSelect(item.id)}
            style={{
              ...itemStyle,
              ...(activeId === item.id ? activeItemStyle : null),
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
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
