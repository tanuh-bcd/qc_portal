import React, { useEffect, useState } from 'react';
import ProgressChart from './ProgressChart';

const RadiologistDashboardHome = () => {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const apiUrl = process.env.REACT_APP_API_URL || '';
        const response = await fetch(`${apiUrl}/api/v1/qc/radiologist/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          setCounts(await response.json());
        } else {
          setError('Failed to load dashboard stats');
        }
      } catch (err) {
        setError('An error occurred while loading dashboard stats');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;
  if (error) return <p style={{ padding: 20, color: 'red' }}>{error}</p>;

  return (
    <div style={{ padding: 20 }}>
      <ProgressChart title="My Case Progress" counts={counts} />
    </div>
  );
};

export default RadiologistDashboardHome;
