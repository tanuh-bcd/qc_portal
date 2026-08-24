const API_URL = process.env.REACT_APP_API_URL || '';

// In-memory cache so we don't refetch on every render/mount.
let _weightsCache = null;
let _thresholdsCache = null;
let _weightsPromise = null;
let _thresholdsPromise = null;

/**
 * Fetches the currently active model weights (logistic regression coefficients).
 * Returns a flat map: { feature_name: weight_value }
 */
export async function fetchActiveWeights() {
  if (_weightsCache) return _weightsCache;
  if (_weightsPromise) return _weightsPromise;

  _weightsPromise = fetch(`${API_URL}/api/v1/model-weights/`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch model weights: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const map = {};
      (data.weights || []).forEach((w) => {
        map[w.feature_name] = w.weight_value;
      });
      _weightsCache = map;
      return map;
    })
    .catch((err) => {
      _weightsPromise = null; // allow retry on next call
      throw err;
    });

  return _weightsPromise;
}

/**
 * Fetches the currently active risk thresholds.
 * Returns an array: [{ risk_category, min_percentage, max_percentage }, ...]
 */
export async function fetchActiveThresholds() {
  if (_thresholdsCache) return _thresholdsCache;
  if (_thresholdsPromise) return _thresholdsPromise;

  _thresholdsPromise = fetch(`${API_URL}/api/v1/risk-thresholds/`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch risk thresholds: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      _thresholdsCache = data.thresholds || [];
      return _thresholdsCache;
    })
    .catch((err) => {
      _thresholdsPromise = null;
      throw err;
    });

  return _thresholdsPromise;
}

/**
 * Convenience helper: fetches both weights and thresholds together.
 * Call this once (e.g. in a parent component's useEffect) and pass the
 * results down to calculateSnehithaRisk / getRiskLevel as needed.
 */
export async function fetchRiskModelConfig() {
  const [weights, thresholds] = await Promise.all([
    fetchActiveWeights(),
    fetchActiveThresholds(),
  ]);
  return { weights, thresholds };
}

/**
 * Computes the PinkShieldAI lifetime risk percentage from questionnaire answers.
 * `weights` must be the map returned by fetchActiveWeights() — no more hardcoded coefficients.
 */
export function calculateSnehithaRisk(formData, weights) {
  if (!weights) {
    throw new Error('calculateSnehithaRisk requires a weights map — call fetchActiveWeights() first.');
  }

  const age = parseInt(formData.Q1, 10) || 0;
  const ageAtMenarche = parseInt(formData.Q10, 10) || 0;
  const irregularCycles = formData.Q12_Current === 'No' ? 1 : 0;
  const breastfeeding24M = formData.Q17 === 'greater than 24 months' ? 1 : 0;
  const firstDegreeRelatives = formData.Q21 === 'First Order (Mother, Sibling, Father)' ? 1 : 0;
  const previousBiopsy = formData.Q40 === 'Yes' ? 1 : 0;
  const isNullipara = formData.Q14 === 'No';
  const ageAtFirstBirth2529 = formData.Q16 === '25 to 29';
  const ageAtFirstBirthGte30 = formData.Q16 === 'After 30';
  const ageAtFirstLiveBirth2529OrNullipara = (isNullipara || ageAtFirstBirth2529) ? 1 : 0;
  const ageAtFirstLiveBirth30OrMore = ageAtFirstBirthGte30 ? 1 : 0;

  const w = (key) => (key in weights ? weights[key] : 0);

  const logit =
    w('intercept') +
    w('age') * age +
    w('age_at_menarche') * ageAtMenarche +
    w('irregular_cycles') * irregularCycles +
    w('breastfeeding_24m') * breastfeeding24M +
    w('first_degree_relatives') * firstDegreeRelatives +
    w('previous_biopsy') * previousBiopsy +
    w('age_first_live_birth_2529_or_nullipara') * ageAtFirstLiveBirth2529OrNullipara +
    w('age_first_live_birth_30_or_more') * ageAtFirstLiveBirth30OrMore;

  const probability = 1 / (1 + Math.exp(-logit));
  let riskPercentage = (probability * 100).toFixed(2);

  if (isNaN(riskPercentage)) {
    riskPercentage = '0.00';
  }

  return riskPercentage;
}

export function getRiskLevel(score, thresholds) {
  const numScore = parseFloat(score);
  if (isNaN(numScore) || !Array.isArray(thresholds) || thresholds.length === 0) return null;
  const match = thresholds.find((t) => {
    const min = t.min_percentage === null || t.min_percentage === undefined ? -Infinity : t.min_percentage;
    const max = t.max_percentage === null || t.max_percentage === undefined ? Infinity : t.max_percentage;
    return numScore >= min && numScore < max;
  });

  return match ? match.risk_category : null;
}

export function getRiskColor(level) {
  switch (level) {
    case 'Baseline Risk': return '#6ee7b7';
    case 'Evident Risk': return '#fde047';
    case 'Significant Risk': return '#fb923c';
    case 'High Risk': return '#fb7185';
    default: return '#ccc';
  }
}