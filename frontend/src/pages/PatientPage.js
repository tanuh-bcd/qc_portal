import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Consent from '../components/Consent';
import Questionnaire from '../components/Questionnaire';
import ThankYou from '../components/ThankYou';
import Layout from '../components/Layout';

const PatientPage = ({ isEmbedded = false }) => {
  const [patientFlowStep, setPatientFlowStep] = useState('consent');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isEmbedded) return;
    const role = localStorage.getItem('role')?.toLowerCase();
    const token = localStorage.getItem('token');
    if (!token || (role !== 'staff' && role !== 'admin')) {
      navigate('/login');
    }
  }, [navigate, isEmbedded]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('hospitalName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    navigate('/login');
  };

  const handleConsentAccept = (result) => {
    setSessionId(result.id);
    setPatientFlowStep('questionnaire');
  };

  const handleQuestionnaireSubmit = async (responses) => {
    if (!sessionId) {
      alert('Session not found. Please complete the consent form again.');
      setPatientFlowStep('consent');
      return;
    }

    setIsSubmitting(true);
    try {
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const token = localStorage.getItem('token');
      
      const response = await fetch(`${apiUrl}/api/v1/patient/questionnaire`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          responses: responses
        })
      });

      if (response.ok) {
        setPatientFlowStep('thankyou');
      } else {
        const errorData = await response.json();
        alert(`Failed to save questionnaire: ${errorData.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error submitting questionnaire:', error);
      alert('An error occurred while submitting the questionnaire.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPatientFlow = () => {
    switch (patientFlowStep) {
      case 'consent':
        return <Consent onAccept={handleConsentAccept} />;
      case 'questionnaire':
        return (
          <Questionnaire 
            onSubmit={handleQuestionnaireSubmit} 
            isSubmitting={isSubmitting} 
          />
        );
      case 'thankyou':
        return <ThankYou onReset={() => {
          setSessionId(null);
          setPatientFlowStep('consent');
        }} />;
      default:
        return <Consent onAccept={handleConsentAccept} />;
    }
  };

  const content = (
    <div style={contentStyle}>
      {renderPatientFlow()}
    </div>
  );

  if (isEmbedded) {
    return content;
  }

  return (
    <Layout userRole="staff" handleLogout={handleLogout} fullWidth={true}>
      {content}
    </Layout>
  );
};

const contentStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '20px 16px',
  minHeight: '400px',
  color: '#666',
  width: '100%',
};

export default PatientPage;
