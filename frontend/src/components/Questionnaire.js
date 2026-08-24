import React, { useState, useEffect } from 'react';
import './Questionnaire.css';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';

function Questionnaire({ onSubmit, isSubmitting }) {
  // Localization hook to handle multi-language support (English, Hindi, Bengali, etc.)
  const { t, i18n } = useTranslation('questionnaire');
  
  // -- State Management --

  // Localized form data: stores answers as displayed in the current UI language
  const [formData, setFormData] = useState({});
  // English form data: stores answers mapped back to English for logic consistency and backend storage
  const [formDataEn, setFormDataEn] = useState({});
  // List of question keys (e.g., 'Q1') that have failed validation (required but empty)
  const [validationErrors, setValidationErrors] = useState([]);
  
  // Special UI states for Question 27 (Breast Self-Examination video)
  const [q27VideoConfirmed, setQ27VideoConfirmed] = useState(false);
  const [showQ27VideoPrompt, setShowQ27VideoPrompt] = useState(false);

  // Dynamic form structure and question maps fetched from the API
  const [formStructure, setFormStructure] = useState([]); // Hierarchical structure by sections
  const [questions, setQuestions] = useState({});       // Localized question data by key
  const [questionsEn, setQuestionsEn] = useState({});   // English question data for translation mapping
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Effect Hook: Fetches questionnaire data from the backend whenever the language changes.
   * It builds a hierarchical structure (sections -> questions -> sub-questions) based on the database content.
   */
  useEffect(() => {
    const loadQuestions = () => {
      setIsLoading(true);
      try {
        const questionnaireData = t('questions', { returnObjects: true });
        const structureData = t('formStructure', { returnObjects: true });
        
        // Get English questions for logic mapping
        const tEn = i18n.getFixedT('english', 'questionnaire');
        const questionnaireDataEn = tEn('questions', { returnObjects: true });

        if (questionnaireData && typeof questionnaireData === 'object') {
          setQuestions(questionnaireData);
          setQuestionsEn(questionnaireDataEn);
        }

        if (Array.isArray(structureData)) {
          setFormStructure(structureData);
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading questions from JSON:", error);
        setIsLoading(false);
      }
    };

    loadQuestions();
  }, [t, i18n]);

  /**
   * Effect Hook: Handles default values from the localization files (e.g., Q45 = "Universal").
   */
  useEffect(() => {
    const defaults = t('ui.defaults', { returnObjects: true });
    if (defaults && typeof defaults === 'object' && defaults.q45) {
      setFormData(prev => ({ ...prev, Q45: defaults.q45 }));
      const tEn = i18n.getFixedT('english', 'questionnaire');
      setFormDataEn(prev => ({ ...prev, Q45: tEn('ui.defaults.q45') }));
    }
  }, [t, i18n]);

  /**
   * Updates form state and synchronization between localized and English data.
   */
  const handleInputChange = (key, value, type) => {
    // 1. Update the localized form data (what the user sees)
    setFormData(prev => ({ ...prev, [key]: value }));
    
    // 2. Map the value to English (what the backend expects)
    let valueEn = value;
    if (type === 'radio' || type === 'select' || type === 'checkbox' || type === 'checkbox-plus-text') {
      const questionData = questions[key];
      const questionDataEn = questionsEn[key];
      if (questionData && questionDataEn && questionData.answers) {
        if (Array.isArray(value)) {
          // Map each selected checkbox option
          valueEn = value.map(v => {
            const index = questionData.answers.indexOf(v);
            return index !== -1 ? questionDataEn.answers[index] : v;
          });
        } else {
          // Map single choice (radio/select)
          const index = questionData.answers.indexOf(value);
          if (index !== -1) {
            valueEn = questionDataEn.answers[index];
          }
        }
      }
    }

    setFormDataEn(prev => {
      const newFormDataEn = { ...prev, [key]: valueEn };
      
      // 220: If the answer changed, we should clear dependent answers that are no longer visible
      // to avoid submitting hidden but filled data that might conflict with logic.
      const clearDependents = (qs) => {
        qs.forEach(q => {
          if (q.condition && q.condition.key === key && newFormDataEn[key] !== q.condition.value) {
            // This question is now hidden because of the change
            delete newFormDataEn[q.key];
            setFormData(prevLocal => {
              const newLocal = { ...prevLocal };
              delete newLocal[q.key];
              return newLocal;
            });
            // Recursively clear its children too
            if (q.subQuestions) clearDependents(q.subQuestions);
          } else if (q.subQuestions) {
            clearDependents(q.subQuestions);
          }
        });
      };
      
      formStructure.forEach(section => clearDependents(section.questions));

      return newFormDataEn;
    });

    // 3. Handle special triggers (like Q27 video prompt)
    if (key === "Q27") {
        const questionDataEn = questionsEn["Q27"];
        const noValueEn = questionDataEn ? questionDataEn.answers[1] : '';
        if (valueEn === noValueEn) {
            setShowQ27VideoPrompt(true);
        } else {
            setShowQ27VideoPrompt(false);
            setQ27VideoConfirmed(false);
        }
    }

    // 4. Clear validation error once the user provides an answer
    if (validationErrors.includes(key)) {
      setValidationErrors(prev => prev.filter(k => k !== key));
    }
  };

  /**
   * Validates that all visible and required questions have an answer.
   */
  const validate = () => {
    const errors = [];
    const checkRequired = (qs) => {
      qs.forEach(q => {
        // Only validate if the question is currently visible based on logic
        const isVisible = !q.condition || formDataEn[q.condition.key] === q.condition.value;

        if (isVisible) {
          if (q.required) {
            const value = formData[q.key];
            const isFilled = Array.isArray(value) ? value.length > 0 : (value !== undefined && value !== '');
            if (!isFilled) {
              errors.push(q.key);
            }
          }
          // Recurse into sub-questions if the visibility toggle allows it
          if (q.subQuestions) {
            const canRecurse = !q.condition || q.condition.key !== q.key || formDataEn[q.key] === q.condition.value;
            if (canRecurse) {
              checkRequired(q.subQuestions);
            }
          }
        }
      });
    };

    formStructure.forEach(section => checkRequired(section.questions));
    setValidationErrors(errors);
    return errors.length === 0;
  };

  /**
   * Prepares the final data and calls the onSubmit prop.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      const responses = [];
      const extractResponses = (qs) => {
        qs.forEach(qConfig => {
          const { key, subQuestions, condition } = qConfig;
          const questionDataEn = questionsEn[key];
          
          // Only collect answers for questions that were actually filled
          const isVisible = !condition || formDataEn[condition.key] === condition.value;
          
          if (isVisible && formDataEn[key] !== undefined && formDataEn[key] !== '' && (!Array.isArray(formDataEn[key]) || formDataEn[key].length > 0)) {
             const showSub = subQuestions && (!condition || condition.key !== key || formDataEn[key] === condition.value);
             
             responses.push({
               question: questionDataEn.question,
               answer: Array.isArray(formDataEn[key]) ? formDataEn[key].join(', ') : String(formDataEn[key])
             });

             // Extra handling for 'Other' specify text fields
             if (key === 'Q43' && formDataEn['q43_other_specify']) {
                responses.push({
                    question: "Other cancer specify",
                    answer: String(formDataEn['q43_other_specify'])
                });
             }

             if (showSub) {
               extractResponses(subQuestions);
             }
          }
        });
      };

      formStructure.forEach(section => extractResponses(section.questions));
      onSubmit(responses);
    } else {
      alert(t('ui.errors.validationAlert'));
    }
  };

  /**
   * Renders the appropriate input component (text, radio, select, etc.) based on type.
   */
  const renderInput = React.useCallback((qConfig) => {
    const { key, type, placeholder, min, max, step } = qConfig;
    const questionData = questions[key];
    if (!questionData) return null;

    switch (type) {
      case 'text':
      case 'number':
        return (
          <input
            type={type}
            placeholder={placeholder}
            value={formData[key] || ''}
            onChange={(e) => handleInputChange(key, e.target.value, type)}
            min={min}
            max={max}
            step={step}
            className={validationErrors.includes(key) ? 'error' : ''}
          />
        );
      case 'radio':
        return (
          <div className="radio-group">
            {questionData.answers.map((answer, i) => (
              <label key={i} className="radio-label">
                <input
                  type="radio"
                  name={key}
                  value={answer}
                  checked={formData[key] === answer}
                  onChange={(e) => handleInputChange(key, e.target.value, type)}
                />
                {answer}
              </label>
            ))}
          </div>
        );
      case 'select':
        return (
          <select
            value={formData[key] || ''}
            onChange={(e) => handleInputChange(key, e.target.value, type)}
            className={validationErrors.includes(key) ? 'error' : ''}
          >
            <option value="">{t('ui.inputs.selectDefault')}</option>
            {questionData.answers.map((answer, i) => (
              <option key={i} value={answer}>{answer}</option>
            ))}
          </select>
        );
      case 'checkbox':
        return (
          <div className="checkbox-group">
            {questionData.answers.map((answer, i) => (
              <label key={i} className="checkbox-label">
                <input
                  type="checkbox"
                  name={key}
                  value={answer}
                  checked={(formData[key] || []).includes(answer)}
                  onChange={(e) => {
                    const currentValues = formData[key] || [];
                    const newValue = e.target.checked
                      ? [...currentValues, answer]
                      : currentValues.filter(v => v !== answer);
                    handleInputChange(key, newValue, type);
                  }}
                />
                {answer}
              </label>
            ))}
          </div>
        );
      case 'checkbox-plus-text':
        // Checkbox group that reveals a text input when the last option (e.g., 'Other') is selected
        return (
          <div className="checkbox-group">
            {questionData.answers.map((answer, i) => (
              <label key={i} className="checkbox-label">
                <input
                  type="checkbox"
                  name={key}
                  value={answer}
                  checked={(formData[key] || []).includes(answer)}
                  onChange={(e) => {
                    const currentValues = formData[key] || [];
                    const newValue = e.target.checked
                      ? [...currentValues, answer]
                      : currentValues.filter(v => v !== answer);
                    handleInputChange(key, newValue, type);
                  }}
                />
                {answer}
              </label>
            ))}
            {(formData[key] || []).includes(questionData.answers[questionData.answers.length - 1]) && (
              <input
                type="text"
                placeholder={qConfig.otherPlaceholder}
                value={formData[qConfig.otherOptionId] || ''}
                onChange={(e) => handleInputChange(qConfig.otherOptionId, e.target.value, 'text')}
                className="other-input"
              />
            )}
          </div>
        );
      default:
        return null;
    }
  }, [questions, formData, handleInputChange, validationErrors, t]);

  /**
   * Recursively renders the list of questions and their nested sub-questions.
   */
  const renderQuestions = React.useCallback((qs, counter) => {
    let currentCounter = counter;
    return qs.map((qConfig) => {
      const { key, subQuestions, condition, videoUrlOnNo } = qConfig;
      const questionData = questions[key];
      if (!questionData) return null;

      // Visibility check for the UI
      const isVisible = !condition || formDataEn[condition.key] === condition.value;
      if (!isVisible) return null;

      currentCounter++;
      const questionDataEn = questionsEn[key];
      const isQ27No = key === "Q27" && formDataEn[key] === (questionDataEn ? questionDataEn.answers[1] : '');

      // Check if we should allow sub-questions to render
      const canRecurse = subQuestions && (!condition || condition.key !== key || formDataEn[key] === condition.value);

      return (
        <React.Fragment key={key}>
          <div className={`question-block ${validationErrors.includes(key) ? 'error' : ''}`}>
            <label>
              {currentCounter}. {questionData.question}
              {qConfig.required && <span className="required-asterisk">*</span>}
            </label>
            {renderInput(qConfig)}
          </div>
          {/* Render nested sub-questions if conditions are met */}
          {canRecurse && (
            <div className="sub-question-container visible">
              {renderQuestions(subQuestions, currentCounter * 100)}
            </div>
          )}
          {/* Special Video Section for Q27 */}
          {key === "Q27" && isQ27No && (
            <div className="video-section">
              {!q27VideoConfirmed && showQ27VideoPrompt && (
                <div className="video-prompt">
                  <p>{t('ui.videoPrompt.note')}</p>
                  <button type="button" onClick={() => setQ27VideoConfirmed(true)}>
                    {t('ui.videoPrompt.button')}
                  </button>
                </div>
              )}
              {q27VideoConfirmed && videoUrlOnNo && (
                <div className="video-container">
                  <video
                    width="100%"
                    controls
                    autoPlay
                    src={videoUrlOnNo}
                    title={t('ui.videoPrompt.videoTitle')}
                    style={{ borderRadius: 8, maxHeight: 400 }}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              )}
            </div>
          )}
        </React.Fragment>
      );
    });
  }, [questions, formDataEn, validationErrors, questionsEn, q27VideoConfirmed, showQ27VideoPrompt, t]); // Note: renderInput is not in deps because it doesn't change

  // -- Progress Calculation Logic --

  /**
   * Helper to find all currently visible and mandatory questions.
   */
  const getRequiredQuestions = React.useCallback((qs, list, currentFormDataEn) => {
    qs.forEach(q => {
      const isVisible = !q.condition || currentFormDataEn[q.condition.key] === q.condition.value;

      if (isVisible) {
        if (q.required) {
          list.push(q);
        }
        if (q.subQuestions) {
          const canRecurse = !q.condition || q.condition.key !== q.key || currentFormDataEn[q.key] === q.condition.value;
          if (canRecurse) {
            getRequiredQuestions(q.subQuestions, list, currentFormDataEn);
          }
        }
      }
    });
  }, []);

  const { totalRequired, filledRequired, progress } = React.useMemo(() => {
    const allRequired = [];
    formStructure.forEach(section => getRequiredQuestions(section.questions, allRequired, formDataEn));

    const total = allRequired.length;
    const filled = allRequired.filter(q => {
      const value = formData[q.key];
      return Array.isArray(value) ? value.length > 0 : (value !== undefined && value !== '');
    }).length;

    return {
      totalRequired: total,
      filledRequired: filled,
      progress: total > 0 ? Math.round((filled / total) * 100) : 0
    };
  }, [formStructure, formData, formDataEn, getRequiredQuestions]);

  // -- Component Rendering --

  if (isLoading) {
    return <div className="loading-container">{t('ui.submitButton.loading')}</div>;
  }

  return (
    <div className="questionnaire-page">
      <LanguageSwitcher />
      {/* Dynamic Progress Bar */}
      <div className="progress-bar-container">
        <div className="progress-bar-text">
          {t('ui.progressBarTemplate', { progress })}
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      <form className="questionnaire-container" onSubmit={handleSubmit}>

        <div className="form-header">
          <h1>{t('ui.header.title')}</h1>
          <p className="instructions">{t('ui.header.instructions')}</p>
          <p className="mandatory-note">
            {t('ui.header.mandatoryPre')}
            <span className="required-asterisk">{t('ui.header.mandatorySymbol')}</span>
            {t('ui.header.mandatoryPost')}
          </p>
        </div>

        {/* Render sections sequentially */}
        {formStructure.map((section, idx) => (
          <div key={idx} className="form-section">
            <h2>{section.title}</h2>
            {renderQuestions(section.questions, idx * 10)}
          </div>
        ))}

        <div className="submit-section">
          <button 
            type="submit" 
            className={`submit-button ${isSubmitting ? 'loading' : ''}`}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('ui.submitButton.loading') : t('ui.submitButton.default')}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Questionnaire;
