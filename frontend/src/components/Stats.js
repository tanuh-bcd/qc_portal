import React, { useState, useEffect } from 'react';
import { Users as UsersIcon, Hospital as HospitalIcon, MapPin as MapPinIcon } from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import './Stats.css';
import RiskTable from './RiskTable';
import IndiaMap from './IndiaMap';
import MammogramStats from './mammogramStats';

const AnimatedCounter = ({ value, duration = 1500 }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = parseInt(value) || 0;
    if (end === 0) { setCount(0); return; }
    const incrementTime = Math.max(duration / end, 1);
    const timer = setInterval(() => {
      start += 1;
      setCount(start);
      if (start >= end) clearInterval(timer);
    }, incrementTime);
    return () => clearInterval(timer);
  }, [value, duration]);

  return <span>{count}</span>;
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const riskOrder = ['Baseline Risk', 'Evident Risk', 'Significant Risk', 'High Risk'];
    const sortedPayload = [...payload].sort((a, b) =>
      riskOrder.indexOf(a.name) - riskOrder.indexOf(b.name)
    );
    const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
    return (
      <div className="custom-tooltip">
        <p className="tooltip-title">{label}</p>
        <div className="tooltip-items">
          {sortedPayload.map((entry, index) => (
            <div key={index} className="tooltip-item">
              <span className="dot" style={{ backgroundColor: entry.color }}></span>
              <span className="name">{entry.name}:</span>
              <span className="value">{entry.value}</span>
            </div>
          ))}
        </div>
        <div className="tooltip-total"><span>Total Collected:</span><span>{total}</span></div>
      </div>
    );
  }
  return null;
};

const CustomLegend = (props) => {
  const { payload } = props;
  const riskOrder = ['Baseline Risk', 'Evident Risk', 'Significant Risk', 'High Risk'];
  const sortedPayload = [...payload].sort((a, b) =>
    riskOrder.indexOf(a.value) - riskOrder.indexOf(b.value)
  );
  return (
    <ul className="custom-legend">
      {sortedPayload.map((entry, index) => (
        <li key={`item-${index}`} className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: entry.color }}></span>
          <span className="legend-text" style={{ color: '#14868C', fontWeight: '600', fontFamily: 'Poppins' }}>{entry.value}</span>
        </li>
      ))}
    </ul>
  );
};

const Stats = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || '';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/stats/`);
        if (!response.ok) throw new Error('Failed to load stats');
        const json = await response.json();
        if (json.riskBins) {
          json.riskBins = json.riskBins.map(bin => {
            if (bin.name === 'No Risk' || bin.name === 'Average Risk') return { ...bin, name: 'Baseline Risk' };
            if (bin.name === 'Low Risk' || bin.name === 'Low-Intermediate Risk' || bin.name === 'Intermediate Risk') return { ...bin, name: 'Evident Risk' };
            if (bin.name === 'Moderate Risk') return { ...bin, name: 'Significant Risk' };
            return bin;
          });
        }
        setData(json);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [API_URL]);

  if (loading) return <div className="stats-loader">Loading Dashboard...</div>;
  if (error) return <div className="stats-error">Error: {error}</div>;

  const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return percent > 0 ? (
      <text x={x} y={y} fill="#111" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" style={{ fontFamily: 'Poppins', fontWeight: '600' }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    ) : null;
  };

  return (
    <div className="stats-container fade-in">
      <div className="stats-header-branding">
        <div className="logos-container" style={{ marginBottom: '1.5rem' }}>
          <img src="/tanuh.png" alt="TANUH Logo" className="logo-tanuh" />
          <img src="/MoE_Logo.svg" alt="Ministry of Education Logo" className="logo-moe" />
          <img src="/IISc_logo.png" alt="IISc Logo" className="logo-iisc" />
        </div>
        <h1 className="stats-main-title">AI enabled Breast Cancer Risk Prediction Tool</h1>
        <p className="stats-powered-by"><span style={{ color: '#e91e8c', fontWeight: 800, fontSize: '2.2rem', fontFamily: 'Poppins, sans-serif', letterSpacing: '1px', textTransform: 'uppercase' }}>PinkShieldAI</span></p>
        <div className="stats-subtitle-container">
          <h2>Analytics Dashboard</h2>
          <p>Real-time project progress dashboard</p>
        </div>
      </div>

      <div className="summary-section">
        <div className="summary-card">
          <div className="card-header-with-icon"><UsersIcon className="summary-icon" size={24} /><h3>Subjects</h3></div>
          <div className="big-number"><AnimatedCounter value={data.totalSubjects} /></div>
        </div>
        <div className="summary-card">
          <div className="card-header-with-icon"><HospitalIcon className="summary-icon" size={24} /><h3>Institutions</h3></div>
          <div className="big-number"><AnimatedCounter value={data.institutionsEmpanelled} /></div>
        </div>
        <div className="summary-card">
          <div className="card-header-with-icon"><MapPinIcon className="summary-icon" size={24} /><h3>States</h3></div>
          <div className="big-number"><AnimatedCounter value={data.statesCount || 0} /></div>
        </div>
      </div>

      <IndiaMap />

      <div className="charts-grid">
        <div className="chart-card full-width">
          <h3>Risk Prediction <a href="#risk-categories-table" style={{ color: '#e03944', fontWeight: 700, textDecoration: 'none' }}>*</a></h3>
          <div className="chart-wrapper pie-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.riskBins} cx="50%" cy="50%" outerRadius="80%" fill="#8884d8" dataKey="value" labelLine={false} label={CustomPieLabel}>
                  {data.riskBins.map((entry, index) => {
                    let cellColor = '#3498db';
                    if (entry.name === 'High Risk') cellColor = '#fb7185';
                    if (entry.name === 'Significant Risk') cellColor = '#fb923c';
                    if (entry.name === 'Evident Risk') cellColor = '#fde047';
                    if (entry.name === 'Baseline Risk') cellColor = '#6ee7b7';
                    return <Cell key={`cell-${index}`} fill={cellColor} />;
                  })}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} content={<CustomLegend />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card full-width">
          <h3>Age Distribution</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ageBins} margin={{ top: 20, right: 30, left: 20, bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14868C" strokeOpacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <YAxis tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36} content={<CustomLegend />} />
                <Bar dataKey="no_risk" name="Baseline Risk" stackId="a" fill="#6ee7b7" />
                <Bar dataKey="low" name="Evident Risk" stackId="a" fill="#fde047" />
                <Bar dataKey="moderate" name="Significant Risk" stackId="a" fill="#fb923c" />
                <Bar dataKey="high" name="High Risk" stackId="a" fill="#fb7185" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card full-width">
          <h3>Institute Distribution</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.hospitalBins} margin={{ top: 20, right: 30, left: 20, bottom: 100 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14868C" strokeOpacity={0.1} />
                <XAxis dataKey="name" angle={0} textAnchor="middle" interval={0} height={60} tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <YAxis tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36} content={<CustomLegend />} />
                <Bar dataKey="no_risk" name="Baseline Risk" stackId="a" fill="#6ee7b7" />
                <Bar dataKey="low" name="Evident Risk" stackId="a" fill="#fde047" />
                <Bar dataKey="moderate" name="Significant Risk" stackId="a" fill="#fb923c" />
                <Bar dataKey="high" name="High Risk" stackId="a" fill="#fb7185" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card full-width">
          <h3>Month-wise Distribution</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthBins || []} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14868C" strokeOpacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <YAxis tick={{ fontSize: 12, fill: '#14868C', fontFamily: 'Poppins', fontWeight: 500 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36} content={<CustomLegend />} />
                <Bar dataKey="no_risk" name="Baseline Risk" stackId="a" fill="#6ee7b7" />
                <Bar dataKey="low" name="Evident Risk" stackId="a" fill="#fde047" />
                <Bar dataKey="moderate" name="Significant Risk" stackId="a" fill="#fb923c" />
                <Bar dataKey="high" name="High Risk" stackId="a" fill="#fb7185" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div style={{ marginTop: '20px', width: '100%' }}><RiskTable /></div>
      <div style={{ marginTop: '20px', width: '100%' }}>
        <MammogramStats />
      </div>
    </div>
  );
};

export default Stats;
