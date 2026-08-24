import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Questionnaire.css';
// NEW: Import the translation hook
import { useTranslation } from 'react-i18next';
import QuestionBlock from './QuestionBlock';

// Helper function to generate random string (Unchanged)
const generateRandomId = (length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};


// NEW: Accept formStructure and questionnaireData as props
function Questionnaire({ onSubmit, isSubmitting, formStructure, questionnaireData, questionnaireDataEn }) {
  
  // NEW: Initialize i18next hook *only* for UI text

  const { t } = useTranslation('questionnaire');
  
  // NEW: Load 'ui' text from the hook
  const ui = t('ui', { returnObjects: true });


  // State hooks
  const [formData, setFormData] = useState({});
  const [formDataEn, setFormDataEn] = useState({});
  const [validationErrors, setValidationErrors] = useState([]);
  const [showQ27VideoPrompt, setShowQ27VideoPrompt] = useState(false);
  const [q27VideoConfirmed, setQ27VideoConfirmed] = useState(false);
  const [randomPatientId, setRandomPatientId] = useState('');
  const [hospitals, setHospitals] = useState([]);
  
  // Helper to get the translated value for a condition
  const getTranslatedConditionValue = useCallback((condition) => {
    if (!condition || !condition.key || !condition.value) return null;
    
    // 1. Get English answers for the condition key
    const enAnswers = questionnaireDataEn[condition.key]?.answers;
    if (!Array.isArray(enAnswers)) return null;

    // 2. Find index of the required value (e.g., "No" is index 1)
    const index = enAnswers.indexOf(condition.value);
    if (index === -1) return null;

    // 3. Get the Translated answer at that index
    // We use the 't' function logic or direct prop access
    const translatedAnswers = questionnaireData[condition.key]?.answers;
    
    // Fallback to English if translation missing
    return translatedAnswers?.[index] || enAnswers[index];
  }, [questionnaireData, questionnaireDataEn]);

  // Effect to set random ID
  useEffect(() => {
    const newId = generateRandomId();
    setRandomPatientId(newId);
  }, []);

  // Fetch hospitals for Q45 dropdown
  useEffect(() => {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    fetch(`${apiUrl}/api/v1/auth/hospitals?questionnaire=true`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setHospitals(data); })
      .catch(() => {});
  }, []);
  
  
  // Progress calculation - OPTIMIZED: Moved to useMemo to avoid extra render cycle
  const progress = useMemo(() => {
    if (!Array.isArray(formStructure)) return 0;

    const getVisibleQuestionKeys = (currentFormData, currentFormDataEn) => {
      const visibleKeys = new Set();
      const traverse = (questions) => {
          if (!Array.isArray(questions)) return; // Safety check
          questions.forEach(q => {
              const qKey = q.name || q.key;

              // NEW: Check if this question (the parent) should be visible
              if (q.condition && q.condition.key !== qKey) {
                if (currentFormDataEn[q.condition.key] !== q.condition.value) {
                  return;
                }
              }

              visibleKeys.add(qKey); 
              if (q.otherOptionId) {
                const valEn = currentFormDataEn[qKey];
                const isOtherSelected = Array.isArray(valEn) 
                  ? (valEn.includes('Other') || valEn.includes('others'))
                  : (valEn === 'Other');
                if (isOtherSelected) {
                  visibleKeys.add(q.otherOptionId);
                }
              }
              
              if (q.subQuestions && q.condition) {
                  // If it's a fork (condition is on another question)
                  if (q.condition.key !== qKey) {
                    if (currentFormDataEn[q.condition.key] === q.condition.value) {
                      traverse(q.subQuestions);
                    }
                  } else {
                    // It's a self-trigger (condition is on this question)
                    const translatedConditionValue = getTranslatedConditionValue(q.condition);
                    if (currentFormData[q.condition.key] === translatedConditionValue) {
                        traverse(q.subQuestions);
                    }
                  }
              }
          });
      };
      formStructure.forEach(section => traverse(section.questions));
      return visibleKeys;
    };

    const countAnsweredVisibleQuestions = (currentFormData, visibleKeysSet) => {
        let answeredCount = 0;
        visibleKeysSet.forEach(key => {
            const value = currentFormData[key];
            if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) {
                answeredCount++;
            }
        });
        return answeredCount;
    };

    const visibleKeysSet = getVisibleQuestionKeys(formData, formDataEn);
    const answeredCount = countAnsweredVisibleQuestions(formData, visibleKeysSet);
    const totalVisible = visibleKeysSet.size;
    const newProgress = totalVisible > 0 ? Math.round((answeredCount / totalVisible) * 100) : 0;
    return Math.min(newProgress, 100);
  }, [formData, formDataEn, formStructure, getTranslatedConditionValue]);


  // handleChange - Refactored to avoid side effects
  // The 'handleChange' function will be re-created on every render (no useCallback)
  // because QuestionBlock ignores its identity anyway in arePropsEqual.
  // This simplifies dependencies and ensures 'formData' is always fresh if needed,
  // but we use functional updates anyway.
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    // CRITICAL FIX: Get translated "No" value for Q27
    const noValue = t('questions.Q27.answers.1'); // Assumes "No" is index 1

    if (name === 'Q27') {
      if (value === noValue) {
        setShowQ27VideoPrompt(true); 
        setQ27VideoConfirmed(false); 
      } else {
        setShowQ27VideoPrompt(false); 
        setQ27VideoConfirmed(false); 
      }
    }

    // Handle changes
    if (type === 'checkbox') {
        const currentValues = formData[name] || [];
        const newValues = checked ? [...currentValues, value] : currentValues.filter(v => v !== value);

        // Calculate English values
        const localAnswers = questionnaireData[name]?.answers || [];
        const englishAnswers = questionnaireDataEn[name]?.answers || [];
        const englishMappedValues = newValues.map(
          val => englishAnswers[localAnswers.indexOf(val)] || val
        );

        // Update both states
        setFormData(prev => ({ ...prev, [name]: newValues }));
        setFormDataEn(prev => ({ ...prev, [name]: englishMappedValues }));

    } else {
        const hindiAnswers = questionnaireData[name]?.answers || [];
        const englishAnswers = questionnaireDataEn[name]?.answers || [];
        const index = hindiAnswers.indexOf(value);
        const englishValue = index !== -1 ? englishAnswers[index] : value;

        setFormData(prev => ({ ...prev, [name]: value }));
        setFormDataEn(prev => ({ ...prev, [name]: englishValue }));
    }
  };


  // getVisibleRequiredQuestions - Modified to use translated "Yes"
  const getVisibleRequiredQuestions = () => {
    let visibleRequired = [];
    const traverseQuestions = (questions) => {
        if (!Array.isArray(questions)) return;
        for (const q of questions) {
            const qKey = q.name || q.key;

            // NEW: Check if this question (the parent) should be visible
            if (q.condition && q.condition.key !== qKey) {
              if (formDataEn[q.condition.key] !== q.condition.value) {
                continue;
              }
            }

            if (q.required) {
                visibleRequired.push(qKey);
            }
            if (q.otherOptionId && q.required) {
              const valEn = formDataEn[qKey];
              const isOtherSelected = Array.isArray(valEn) 
                ? (valEn.includes('Other') || valEn.includes('others'))
                : (valEn === 'Other');
              if (isOtherSelected) {
                visibleRequired.push(q.otherOptionId);
              }
            }
            
            if (q.subQuestions && q.condition) {
                // If it's a fork (condition is on another question)
                if (q.condition.key !== qKey) {
                  if (formDataEn[q.condition.key] === q.condition.value) {
                    traverseQuestions(q.subQuestions);
                  }
                } else {
                  // It's a self-trigger (condition is on this question)
                  const translatedConditionValue = getTranslatedConditionValue(q.condition);
                  if (formData[q.condition.key] === translatedConditionValue) {
                      traverseQuestions(q.subQuestions);
                  }
                }
            }
        }
    };
    if (Array.isArray(formStructure)) {
      formStructure.forEach(section => traverseQuestions(section.questions));
    }
    // console.log('Visible Required Keys:', visibleRequired);
    return visibleRequired;
  };
  // Helper: validate numeric rules and return array of failing keys
  const validateNumericRules = (data) => {
    const failures = [];

    if (!Array.isArray(formStructure)) return failures;

    const traverse = (questions) => {
      if (!Array.isArray(questions)) return;
      for (const q of questions) {
        const key = q.name || q.key;

        // NEW: Check if this question (the parent) should be visible
        if (q.condition && q.condition.key !== key) {
          if (formDataEn[q.condition.key] !== q.condition.value) {
            continue;
          }
        }

        // Only validate numeric fields that have value
        if (q.type === 'number') {
          const raw = data[key];
          if (raw !== undefined && raw !== null && raw !== '') {
            // coerce to number safely
            const num = Number(raw);
            if (Number.isNaN(num)) {
              failures.push(key);
              continue;
            }
            if (q.integerOnly && !Number.isInteger(num)) {
              failures.push(key);
              continue;
            }
            if (q.min !== undefined && num < q.min) {
              failures.push(key);
              continue;
            }
            if (q.max !== undefined && num > q.max) {
              failures.push(key);
              continue;
            }
          }
        }
        // Recurse into subQuestions
        if (q.subQuestions && q.condition) {
           if (q.condition.key !== key) {
             if (formDataEn[q.condition.key] === q.condition.value) {
               traverse(q.subQuestions);
             }
           } else {
             const translatedConditionValue = getTranslatedConditionValue(q.condition);
             if (data[q.condition.key] === translatedConditionValue) {
               traverse(q.subQuestions);
             }
           }
        }
      }
    };

    formStructure.forEach(section => traverse(section.questions));
    return failures;
  };

  
  // handleSubmit (with default value logic) - Modified for translated text
  const handleSubmit = (e) => {
    e.preventDefault();
    setValidationErrors([]);

    const dataToSubmit = { ...formData };
    const dataToSubmitEn = { ...formDataEn };


    const visibleRequiredKeys = getVisibleRequiredQuestions();
    const missingFields = visibleRequiredKeys.filter(key => {
        const value = dataToSubmit[key];
        return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    });
    // console.log('Submitting:', { dataToSubmit, dataToSubmitEn, missingFields });

    const numericFailures = validateNumericRules(dataToSubmit);

    const combinedFailures = [...new Set([...missingFields, ...numericFailures])];
    // console.log('Validation Failures:', combinedFailures);

    if (combinedFailures.length > 0) {
      setValidationErrors(combinedFailures);
      alert(t('ui.errors.validationAlert')); // same alert
      const firstErrorKey = combinedFailures[0];
      const errorElement = document.querySelector(`[name="${firstErrorKey}"]`);
      if (errorElement) {
        errorElement.closest('.question-block').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

  
    onSubmit(dataToSubmit, dataToSubmitEn);
  };

  // renderSubQuestions - renders sub-questions for a parent question
  const renderSubQuestions = (subQuestions, parentNumber, currentQuestionnaireData, currentQuestionnaireDataEn, currentFormData, currentFormDataEn, currentValidationErrors) => {
    if (!Array.isArray(subQuestions)) return null;

    return subQuestions.map((subQConfig, index) => {
      const subQData = currentQuestionnaireData[subQConfig.key];
      if (!subQData) return null;

      const subQKey = subQConfig.name || subQConfig.key;
      const conditionKey = subQConfig.condition ? subQConfig.condition.key : null;

      // --- LOGIC 1: SHOULD THIS QUESTION (THE PARENT) RENDER? ---
      if (subQConfig.condition && conditionKey !== subQKey) {
         if (currentFormDataEn[conditionKey] !== subQConfig.condition.value) {
             return null; 
         }
      }

      const displayNumber = `${parentNumber}${String.fromCharCode(97 + index)}.`;

      // --- LOGIC 2: PRE-CALCULATE CHILDREN ---
      let renderedChildren = null;
      let allowChildren = true;
      if (subQConfig.condition && conditionKey === subQKey) {
          if (currentFormDataEn[subQKey] !== subQConfig.condition.value) {
              allowChildren = false;
          }
      }

      if (subQConfig.subQuestions && allowChildren) {
          renderedChildren = renderSubQuestions(subQConfig.subQuestions, displayNumber.slice(0,-1), currentQuestionnaireData, currentQuestionnaireDataEn, currentFormData, currentFormDataEn, currentValidationErrors);
      }

      const hasValidChildren = Array.isArray(renderedChildren) && renderedChildren.some(child => child !== null);

      return (
        <React.Fragment key={subQKey}>
          <QuestionBlock
            qConfig={subQConfig}
            questionnaireData={currentQuestionnaireData}
            questionnaireDataEn={currentQuestionnaireDataEn}
            formData={currentFormData}
            formDataEn={currentFormDataEn}
            validationErrors={currentValidationErrors}
            handleChange={handleChange}
            t={t}
            displayNumber={displayNumber}
            randomPatientId={randomPatientId}
            hospitals={hospitals}
          />
          {hasValidChildren && (
            <div className="sub-question-container visible">
              {renderedChildren}
            </div>
          )}
        </React.Fragment>
      );
    });
  };

  let questionCounter = 0;

  // Loading check (important!)
  // If the data hasn't been loaded by i18next yet, show a loading message
  if (!Array.isArray(formStructure) || !ui.header || !questionnaireData.Q1) {
    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
            Loading questionnaire content...
        </div>
    );
  }

  // --- Main return JSX - Modified to use translated 'ui' object ---
  return (
    <>
      <div className="progress-bar-container">
        {/* <div className="progress-bar-label">{t('ui.progressBarTemplate', {progress: progress})}</div> */}
        <div className="progress-bar-label">{ui.progressBarTemplate.replace('{progress}', progress)}</div>
        <div className="progress-bar-track">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${progress}%` }} 
          ></div>
        </div>
      </div>

      <form className="questionnaire-container" onSubmit={handleSubmit} noValidate>
        <div className="logos-container" style={{ marginBottom: '1rem' }}>
          <img src="/tanuh.png" alt="TANUH Logo" className="logo-tanuh" />
          <img src="/MoE_Logo.svg" alt="MoE Logo" className="logo-moe" />
          <img src="/IISc_logo.png" alt="IISc Logo" className="logo-iisc" />
        </div>
        <div className="form-header">
          <h1>{t('ui.header.title')}</h1>
          <p style={{ color: "#533b42ff", fontSize: "18px", marginTop: "8px" }}>{t('ui.header.instructions')}</p>
          <p style={{ color: "#533b42ff", fontSize: "15px", marginTop: "8px" }}>
            {t('ui.header.mandatoryPre')}
            <span style={{ color: "#d93025", fontWeight: 600 }}>{t('ui.header.mandatorySymbol')}</span>
            {t('ui.header.mandatoryPost')}
          </p>
        </div>
        
        {formStructure.map((section, index) => (
          <div key={index} className="form-section">
            <h2>{t(section.title)}</h2> {/* Get section title from translation */}
            {section.questions.map((qConfig) => {
              const data = questionnaireData[qConfig.key];
              if (!data) return null;
              
              // NEW: Check for top-level condition (like gender-based hiding)
              // FIX: Only hide if the condition is based on ANOTHER question.
              // If condition.key === qConfig.key, it's a self-referencing condition used for subquestions.
              if (qConfig.condition && qConfig.condition.key !== qConfig.key) {
                if (formDataEn[qConfig.condition.key] !== qConfig.condition.value) {
                  return null;
                }
              }

              questionCounter++;
              const displayNumber = `${questionCounter}.`;
              const name = qConfig.name || qConfig.key;
              
              const noValueQ27 = t('questions.Q27.answers.1'); 
              const isQ27No = qConfig.key === "Q27" && formData[name] === noValueQ27;
              
              const children = qConfig.subQuestions ? renderSubQuestions(qConfig.subQuestions, displayNumber, questionnaireData, questionnaireDataEn, formData, formDataEn, validationErrors) : null;
              const hasValidChildren = Array.isArray(children) && children.some(child => child !== null);

              return (
                <React.Fragment key={name}>
                  <QuestionBlock
                    qConfig={qConfig}
                    questionnaireData={questionnaireData}
                    questionnaireDataEn={questionnaireDataEn}
                    formData={formData}
                    formDataEn={formDataEn}
                    validationErrors={validationErrors}
                    handleChange={handleChange}
                    t={t}
                    displayNumber={displayNumber}
                    isQ27No={isQ27No}
                    showQ27VideoPrompt={showQ27VideoPrompt}
                    q27VideoConfirmed={q27VideoConfirmed}
                    setQ27VideoConfirmed={setQ27VideoConfirmed}
                    randomPatientId={randomPatientId}
                    hospitals={hospitals}
                  />
                  {hasValidChildren && (
                    <div className="sub-question-container visible">
                      {children}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ))}
        <div className="submit-button-container">
          {isSubmitting ? (
            <button type="button" className="submit-button loading" disabled>
              <span className="loading-dots"><span></span><span></span><span></span></span>
              {t('ui.submitButton.loading')}
            </button>
          ) : (
            <button type="submit" className="submit-button">
              {t('ui.submitButton.default')}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export default Questionnaire;
