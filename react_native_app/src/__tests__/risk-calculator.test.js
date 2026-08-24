import { calculateSnehithaRisk, getRiskLevel, getRiskColor } from '../services/risk-calculator';

describe('calculateSnehithaRisk', () => {
  test('returns a number string for minimal input', () => {
    const result = calculateSnehithaRisk({ Q1: '40' });
    expect(parseFloat(result)).toBeGreaterThan(0);
  });

  test('returns 0.00 or valid number for empty input', () => {
    const result = calculateSnehithaRisk({});
    expect(parseFloat(result)).toBeGreaterThanOrEqual(0);
  });

  test('age increases risk', () => {
    const young = parseFloat(calculateSnehithaRisk({ Q1: '25' }));
    const old = parseFloat(calculateSnehithaRisk({ Q1: '60' }));
    expect(old).toBeGreaterThan(young);
  });

  test('breastfeeding >24 months decreases risk', () => {
    const base = { Q1: '40', Q10: '13' };
    const noBf = parseFloat(calculateSnehithaRisk({ ...base, Q17: 'less than 24 months' }));
    const bf = parseFloat(calculateSnehithaRisk({ ...base, Q17: 'greater than 24 months' }));
    expect(bf).toBeLessThan(noBf);
  });

  test('previous biopsy increases risk', () => {
    const base = { Q1: '40', Q10: '13' };
    const noBiopsy = parseFloat(calculateSnehithaRisk({ ...base, Q40: 'No' }));
    const biopsy = parseFloat(calculateSnehithaRisk({ ...base, Q40: 'Yes' }));
    expect(biopsy).toBeGreaterThan(noBiopsy);
  });

  test('first degree family history increases risk', () => {
    const base = { Q1: '40', Q10: '13' };
    const noFh = parseFloat(calculateSnehithaRisk({ ...base, Q21: 'No' }));
    const fh = parseFloat(calculateSnehithaRisk({ ...base, Q21: 'First Order (Mother, Sibling, Father)' }));
    expect(fh).toBeGreaterThan(noFh);
  });

  test('nullipara increases risk vs early first birth', () => {
    const base = { Q1: '40', Q10: '13' };
    const earlyBirth = parseFloat(calculateSnehithaRisk({ ...base, Q14: 'Yes', Q16: 'Before 24' }));
    const nullipara = parseFloat(calculateSnehithaRisk({ ...base, Q14: 'No' }));
    expect(nullipara).toBeGreaterThan(earlyBirth);
  });

  test('high risk profile produces >50%', () => {
    const result = parseFloat(calculateSnehithaRisk({
      Q1: '55', Q10: '10', Q12_Current: 'No', Q14: 'No',
      Q17: 'less than 24 months', Q21: 'First Order (Mother, Sibling, Father)', Q40: 'Yes'
    }));
    expect(result).toBeGreaterThan(50);
  });

  test('low risk profile produces <30%', () => {
    const result = parseFloat(calculateSnehithaRisk({
      Q1: '30', Q10: '14', Q12_Current: 'Yes', Q14: 'Yes',
      Q16: 'Before 24', Q17: 'greater than 24 months', Q21: 'No', Q40: 'No'
    }));
    expect(result).toBeLessThan(30);
  });
});

describe('getRiskLevel', () => {
  test('baseline for low score', () => {
    expect(getRiskLevel('20')).toBe('Baseline Risk');
  });

  test('evident for mid-low score', () => {
    expect(getRiskLevel('45')).toBe('Evident Risk');
  });

  test('significant for mid-high score', () => {
    expect(getRiskLevel('65')).toBe('Significant Risk');
  });

  test('high for high score', () => {
    expect(getRiskLevel('85')).toBe('High Risk');
  });

  test('null for NaN input', () => {
    expect(getRiskLevel('abc')).toBeNull();
  });
});

describe('getRiskColor', () => {
  test('returns green for baseline', () => {
    expect(getRiskColor('Baseline Risk')).toBe('#6ee7b7');
  });

  test('returns red-ish for high', () => {
    expect(getRiskColor('High Risk')).toBe('#fb7185');
  });

  test('returns default for unknown', () => {
    expect(getRiskColor('Unknown')).toBe('#ccc');
  });
});
