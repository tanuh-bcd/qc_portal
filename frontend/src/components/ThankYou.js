import React from 'react';
import './ThankYou.css';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';
function ThankYou({ onReset }) {
  const { t } = useTranslation('thankyou');

  return (
    <div className="thank-you-container">
      <div className="thank-you-card">
        <div className="success-icon">
          <CheckCircle size={80} color="#14868C" />
        </div>

        <h1>{t('title')}</h1>
        <p className="message">{t('message')}</p>

        {t('nextSteps.title') && (
          <div className="info-section">
            <h2>{t('nextSteps.title')}</h2>
            <ul>
              {Array.isArray(t('nextSteps.items', { returnObjects: true })) &&
                t('nextSteps.items', { returnObjects: true }).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
            </ul>
          </div>
        )}

        <button className="reset-button" onClick={onReset}>
          {t('buttons.reset') || 'Start New Screening'}
        </button>
      </div>
    </div>
  );
}

export default ThankYou;
