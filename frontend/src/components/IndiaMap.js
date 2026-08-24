import React, { useState, useEffect, useRef, useCallback } from 'react';
import './IndiaMap.css';

function projectCoordinate(projection, lng, lat) {
  if (!projection) return null;
  return [
    projection.offsetX + (lng - projection.minLng) * projection.scale,
    projection.offsetY + (projection.maxLat - lat) * projection.scale,
  ];
}

function clusterMarkers(groups, projection) {
  const projected = groups
    .map((g) => {
      const pt = projectCoordinate(projection, g.longitude, g.latitude);
      if (!pt) return null;
      return { ...g, x: pt[0], y: pt[1], offsetX: 0, offsetY: 0 };
    })
    .filter(Boolean);

  const remaining = [...projected];
  const clusters = [];
  const threshold = 12;

  while (remaining.length) {
    const cluster = [remaining.shift()];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (
          cluster.some(
            (c) => Math.hypot(c.x - remaining[i].x, c.y - remaining[i].y) <= threshold
          )
        ) {
          cluster.push(remaining.splice(i, 1)[0]);
          changed = true;
        }
      }
    }
    clusters.push(cluster);
  }

  clusters.forEach((cluster) => {
    if (cluster.length <= 1) return;
    const radius = cluster.length > 3 ? 18 : 14;
    cluster
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .forEach((item, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / cluster.length;
        item.offsetX = Math.cos(angle) * radius;
        item.offsetY = Math.sin(angle) * radius;
      });
  });

  return projected;
}

const IndiaMap = () => {
  const [mapData, setMapData] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [activeMarker, setActiveMarker] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const wrapRef = useRef(null);
  const API_URL = process.env.REACT_APP_API_URL || '';

  useEffect(() => {
    Promise.all([
      fetch('/maps/india_states_paths.json').then((r) => {
        if (!r.ok) throw new Error('Map data unavailable');
        return r.json();
      }),
      fetch(`${API_URL}/api/v1/stats/hospital-locations`).then((r) => {
        if (!r.ok) throw new Error('Hospital locations unavailable');
        return r.json();
      }),
    ])
      .then(([map, locs]) => {
        setMapData(map);
        setHospitals(locs);

        const defaultIdx = (map.states || []).findIndex(
          (s) => (s.name || '').trim().toLowerCase() === 'karnataka'
        );
        if (defaultIdx !== -1) {
          setSelectedState({ index: defaultIdx, name: map.states[defaultIdx].name });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [API_URL]);

  const handleMarkerEnter = useCallback((group, e) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const dot = e.currentTarget;
    const mr = dot.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const hospList = Array.isArray(group.hospitals) ? group.hospitals : [group];
    const city = hospList[0]?.city || '';
    const state = group.state || hospList[0]?.state || '';
    const location = [city, state].filter(Boolean).join(', ');
    setTooltip({
      left: mr.left - wr.left + mr.width / 2,
      top: mr.top - wr.top,
      hospitals: hospList,
      location,
    });
  }, []);

  const handleMarkerLeave = useCallback(() => {
    setTooltip(null);
    setActiveMarker(null);
  }, []);

  const handleMarkerClick = useCallback((group, idx, e) => {
    e.stopPropagation();
    if (activeMarker === idx) {
      setTooltip(null);
      setActiveMarker(null);
    } else {
      handleMarkerEnter(group, e);
      setActiveMarker(idx);
    }
  }, [activeMarker, handleMarkerEnter]);

  const handleStateClick = useCallback((s, idx, e) => {
    e.stopPropagation();
    setSelectedState((prev) =>
      prev && prev.index === idx
        ? null
        : { index: idx, name: s.name || 'Unknown region' }
    );
    setTooltip(null);
    setActiveMarker(null);
  }, []);

  const handleWrapClick = useCallback((e) => {
    if (
      !e.target.classList.contains('marker-dot') &&
      !e.target.classList.contains('india-state')
    ) {
      setTooltip(null);
      setActiveMarker(null);
    }
  }, []);
  
  if (loading) return <div className="india-map-loading">Loading map...</div>;
  if (error) return <div className="india-map-error">{error}</div>;
  if (!mapData) return null;

  const viewBoxStr = mapData.viewBox || '0 0 640 720';
  const vbParts = viewBoxStr.split(/\s+/).map(Number);
  const mapAspect =
    vbParts.length === 4 && vbParts[2] && vbParts[3]
      ? `${vbParts[2]} / ${vbParts[3]}`
      : '640 / 720';

  const grouped = new Map();
  for (const h of hospitals) {
    const key = `${Number(h.latitude).toFixed(3)},${Number(h.longitude).toFixed(3)}`;
    const g = grouped.get(key) || {
      latitude: h.latitude,
      longitude: h.longitude,
      state: h.state,
      hospitals: [],
    };
    g.hospitals.push(h);
    grouped.set(key, g);
  }
  const groups = Array.from(grouped.values());
  const markers = clusterMarkers(groups, mapData.projection);

  const selectedStateHospitals = selectedState
    ? hospitals.filter((h) => h.state === selectedState.name)
    : [];

  return (
    <div className="india-map-section">
      <div className="india-map-header">
        <h3>Medical Partner Locations</h3>
      </div>
      <div className="public-map-wrap" ref={wrapRef} onClick={handleWrapClick}>
        <svg
          className="india-map"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="India map showing partner hospital locations"
          style={{ '--map-aspect': mapAspect }}
        >
          <g className="india-map-states">
            {(mapData.states || []).map((s, i) =>
              s.path ? (
                <path
                  key={i}
                  d={s.path}
                  className={`india-state${selectedState && selectedState.index === i ? ' selected' : ''
                    }`}
                  aria-label={s.name || 'Indian state'}
                  tabIndex={0}
                  role="button"
                  onClick={(e) => handleStateClick(s, i, e)}
                />
              ) : null
            )}
          </g>
          <g className="india-map-markers">
            {markers.map((m, i) => {
              const count = m.hospitals ? m.hospitals.length : 1;
              return (
                <g
                  key={i}
                  className="india-hospital-marker"
                  transform={`translate(${m.x.toFixed(2)} ${m.y.toFixed(2)})`}
                >
                  <g
                    className="marker-pin"
                    transform={`translate(${m.offsetX.toFixed(2)} ${m.offsetY.toFixed(2)})`}
                  >
                    <circle className="marker-pulse" r="9" />
                    <circle
                      className="marker-dot"
                      r={count > 1 ? 8 : 6}
                      tabIndex={0}
                      role="button"
                      aria-label={`${m.state}: ${count} hospital${count > 1 ? 's' : ''}`}
                      onMouseEnter={(e) => handleMarkerEnter(m, e)}
                      onMouseLeave={handleMarkerLeave}
                      onClick={(e) => handleMarkerClick(m, i, e)}
                      onFocus={(e) => handleMarkerEnter(m, e)}
                      onBlur={handleMarkerLeave}
                    />
                    {count > 1 && (
                      <text className="marker-count" y="2.5">
                        {count}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div
            className="public-map-tooltip"
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            <ul>
              {tooltip.hospitals.map((h, i) => (
                <li key={i}>
                  <strong>{h.name}</strong>
                  <span className="map-tip-subjects">{h.subjects || 0} records</span>
                </li>
              ))}
            </ul>
            <div className="map-tip-location">{tooltip.location}</div>
          </div>
        )}

        {selectedState && (
          <div className="india-info-panel" onClick={(e) => e.stopPropagation()}>
            <div className="info-panel-header">
              <span className="info-panel-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <div>
                <span className="info-panel-label">Selected Location</span>
                <h4>{selectedState.name}</h4>
              </div>
            </div>

            <div className="info-panel-count">
              <span className="count-number">{selectedStateHospitals.length}</span>
              <span className="count-label">Medical partners</span>
            </div>

            <p className="info-panel-message">
              {selectedStateHospitals.length > 0
                ? `${selectedStateHospitals.length} clinical partner${selectedStateHospitals.length > 1 ? 's' : ''
                } in ${selectedState.name}.`
                : 'No clinical partners as of now.'}
            </p>

            {selectedStateHospitals.length > 0 && (
              <ul className="info-panel-hospital-list">
                {selectedStateHospitals.map((h, i) => (
                  <li key={h.id ?? i} className="info-panel-hospital-item">
                    <span className="hospital-item-name">
                      {[h.name, h.city].filter(Boolean).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IndiaMap;