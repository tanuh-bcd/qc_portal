import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Consent from '../components/Consent.jsx';
import Questionnaire from '../components/Questionnaire.jsx';
import ThankYou from '../components/ThankYou.jsx';

const API_URL = process.env.REACT_APP_API_URL || '';

const PublicQuestionnairePage = () => {
  const [step, setStep] = useState('consent');
  const [sessionId, setSessionId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [riskResult, setRiskResult] = useState(null);
  const [finalFormData, setFinalFormData] = useState(null);

  const { t, ready } = useTranslation(['consent', 'questionnaire', 'thankyou']);

  const formStructure = ready ? t('questionnaire:formStructure', { returnObjects: true }) : [];
  const questionnaireData = ready ? t('questionnaire:questions', { returnObjects: true }) : {};

  const handleConsentAccept = async (result) => {
    try {
      const res = await fetch(`${API_URL}/api/session/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.sessionId) {
        setSessionId(data.sessionId);

        if (result && result.file) {
          const formData = new FormData();
          formData.append('file', result.file);
          fetch(`${API_URL}/api/session/${data.sessionId}/consent`, {
            method: 'POST',
            body: formData,
          }).catch(() => {});
        }

        setStep('questionnaire');
        window.scrollTo(0, 0);
      } else {
        alert('Could not start a session. Please try again.');
      }
    } catch (error) {
      alert('Could not connect to the server. Please try again.');
    }
  };

  const handleSubmit = async (formData, formDataEn) => {
    if (!sessionId) return;
    setIsSubmitting(true);
    setFinalFormData(formDataEn || formData);

    const submitData = formDataEn || formData;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${API_URL}/api/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, formDataEn: submitData }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const detail = Array.isArray(errorData.detail)
            ? errorData.detail.map(e => e.msg || e.type).join('; ')
            : errorData.detail || 'Server error';
          if (res.status >= 500 && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          alert(`Submission failed: ${detail}. Please try again.`);
          setFinalFormData(null);
          setIsSubmitting(false);
          return;
        }
        const result = await res.json();
        if (result.success) {
          setRiskResult(result.riskPercentage);
          setStep('thankyou');
          window.scrollTo(0, 0);
        } else {
          alert('Submission failed. Please try again.');
          setFinalFormData(null);
        }
        setIsSubmitting(false);
        return;
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        alert('Could not connect to the server. Please try again.');
        setFinalFormData(null);
        setIsSubmitting(false);
        return;
      }
    }
  };

  const handleReset = () => {
    setStep('consent');
    setSessionId(null);
    setRiskResult(null);
    setFinalFormData(null);
  };

  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 16px', width: '100%' }}>
      {step === 'consent' && <Consent onAccept={handleConsentAccept} />}
      {step === 'questionnaire' && (
        <Questionnaire
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          formStructure={formStructure}
          questionnaireData={questionnaireData}
          questionnaireDataEn={questionnaireData}
        />
      )}
      {step === 'thankyou' && (
        <ThankYou
          riskResult={riskResult}
          formData={finalFormData}
          sessionId={sessionId}
          onReset={handleReset}
          formStructure={Array.isArray(formStructure) ? formStructure : []}
          questionnaireData={questionnaireData}
        />
      )}
    </div>
  );
};

export default PublicQuestionnairePage;
