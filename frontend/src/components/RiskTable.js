import React, { useEffect, useState } from 'react';
import './RiskTable.css';

const API_URL = process.env.REACT_APP_API_URL || '';

const RiskTable = () => {
    const [tableData, setTableData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchRiskCategories = async () => {
            try {
                const res = await fetch(`${API_URL}/api/v1/risk-categories/`);
                if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                const data = await res.json();
                const mapped = data.map((row) => {
                    const match = row.description.match(/^(.*?Category:)\s*(.*)$/s);

                    const descriptionNode = match
                        ? <span><strong>{match[1]}</strong> {match[2]}</span>
                        : <span>{row.description}</span>;

                    return {
                        category: row.riskCategory,
                        percentage: row.lifetimeRiskPercentage,
                        description: descriptionNode,
                        nextSteps: row.recommendation
                            .split('. ')
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .map((s) => (s.endsWith('.') ? s : `${s}.`))
                    };
                });
                setTableData(mapped);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchRiskCategories();
    }, []);

    if (loading) return <div className="risk-table-container fade-in">Loading risk categories…</div>;
    if (error) return <div className="risk-table-container fade-in">Failed to load risk categories.</div>;

    return (
        <div id="risk-categories-table" className="risk-table-container fade-in">
            <h4 className="risk-table-title">Risk Categories Reference</h4>
            <div className="risk-table-wrapper">
                <table className="risk-table">
                    <thead>
                        <tr>
                            <th>Risk Category</th>
                            <th>Lifetime Risk Percentage</th>
                            <th>Description</th>
                            <th>Recommendation (next steps)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((row, idx) => {
                            let bgColor = 'inherit';
                            if (row.category.includes('High')) bgColor = '#fb7185';
                            else if (row.category.includes('Significant')) bgColor = '#fb923c';
                            else if (row.category.includes('Evident')) bgColor = '#fde047';
                            else if (row.category.includes('Baseline')) bgColor = '#6ee7b7';

                            return (
                                <tr key={idx} style={{ backgroundColor: bgColor, color: '#111' }}>
                                    <td style={{ color: '#111', fontWeight: '500' }}>{row.category}</td>
                                    <td style={{ color: '#111', whiteSpace: 'nowrap' }}>{row.percentage}</td>
                                    <td style={{ color: '#111' }}>{row.description}</td>
                                    <td style={{ color: '#111' }}>
                                        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                                            {row.nextSteps.map((step, i) => (
                                                <li key={i} style={{ marginBottom: '4px' }}>{step}</li>
                                            ))}
                                        </ul>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="risk-table-footnote">
                <span style={{ color: '#e03944', fontWeight: 700 }}>*</span>{' '}
                Risk categories shown in the Risk Prediction chart are based on the lifetime risk thresholds defined in this table.
            </p>
        </div>
    );
};

export default RiskTable;