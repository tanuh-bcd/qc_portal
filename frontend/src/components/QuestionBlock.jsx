import React, { memo } from 'react';

// Optimization: Extracted this component to apply React.memo.
// The Questionnaire component renders many of these blocks.
// Memoization prevents re-rendering all questions when typing in a single field,
// provided the custom comparator filters out unrelated state changes.
const QuestionBlock = ({
  qConfig,
  questionnaireData,
  questionnaireDataEn,
  formData,
  formDataEn,
  validationErrors,
  handleChange,
  t,
  displayNumber,
  randomPatientId, // NEW: Passed prop
  hospitals,
  // Q27 specific props
  isQ27No,
  showQ27VideoPrompt,
  q27VideoConfirmed,
  setQ27VideoConfirmed,
}) => {
  const name = qConfig.name || qConfig.key;
  const data = questionnaireData[qConfig.key];

  if (!data) return <p>{t('ui.errors.questionNotFound', { key: qConfig.key })}</p>;

  // --- renderInput Logic ---
  const renderInput = (config) => {
    const qName = config.name || config.key;
    const qData = questionnaireData[config.key];
    if (!qData) return null;

    let placeholder = config.placeholder || '';
    if (config.key === 'Q44') {
      // FIX: Use the prop for placeholder
      placeholder = randomPatientId;
    }

    if (config.type === 'hospital-select') {
      return (
        <select name={qName} onChange={handleChange} value={formData[qName] || ""} className="select-input">
          <option value="" disabled>{t('ui.inputs.selectDefault')}</option>
          {(hospitals || []).map((h) => <option key={h.id} value={h.name}>{h.name}</option>)}
        </select>
      );
    }

    if (!Array.isArray(qData.answers) || qData.answers.length === 0) {
      if (config.type === 'number') {
        const minAttr = config.min !== undefined ? config.min : undefined;
        const maxAttr = config.max !== undefined ? config.max : undefined;
        const stepAttr = config.step !== undefined ? config.step : undefined;

        return (
          <>
            <input
              type="number"
              name={qName}
              placeholder={placeholder}
              value={formData[qName] || ''}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (config.integerOnly && (e.key === '.' || e.key === ',')) {
                  e.preventDefault();
                }
              }}
              className="text-input"
              min={minAttr}
              max={maxAttr}
              step={stepAttr}
            />
            {validationErrors.includes(qName) && (
              <div className="field-error">
                {config.min !== undefined && config.max !== undefined
                  ? `${t('ui.invalidInput.numberPrefix')} ${config.min} ${t('ui.invalidInput.and')} ${config.max}.`
                  : `${t('ui.invalidInput.validInput')} `}
              </div>
            )}
          </>
        );
      }
      return (
        <input
          type={config.type || 'text'}
          name={qName}
          placeholder={placeholder}
          value={formData[qName] || ''}
          onChange={handleChange}
          className="text-input"
        />
      );
    }

    switch (config.type) {
      case 'select':
      case 'select-plus-text':
        return (
          <>
            <select name={qName} onChange={handleChange} value={formData[qName] || ""} className="select-input">
              <option value="" disabled>{t('ui.inputs.selectDefault')}</option>
              {qData.answers.map((ans, i) => <option key={i} value={ans}>{ans}</option>)}
            </select>
            {config.type === 'select-plus-text' && formDataEn[qName] === 'Other' && (
              <input
                type="text"
                name={config.otherOptionId}
                placeholder={config.otherPlaceholder || t('ui.inputs.otherPlaceholder', 'Specify other')}
                onChange={handleChange}
                className="text-input"
                value={formData[config.otherOptionId] || ''}
                required={config.required}
              />
            )}
          </>
        );
      case 'checkbox':
      case 'checkbox-plus-text':
        return (
          <div className="checkbox-group vertical">
            {qData.answers.map((ans, i) => (
              <label key={i}>
                <input
                  type="checkbox" name={qName} value={ans} onChange={handleChange}
                  checked={formData[qName]?.includes(ans) || false}
                /> {ans}
              </label>
            ))}
            {config.type === 'checkbox-plus-text' && (formDataEn[qName]?.includes('Other') || formDataEn[qName]?.includes('others')) && (
              <input
                type="text"
                name={config.otherOptionId}
                placeholder={config.otherPlaceholder || t('ui.inputs.otherPlaceholder', 'Specify other')}
                onChange={handleChange}
                className="text-input"
                value={formData[config.otherOptionId] || ''}
                required={config.required}
              />
            )}
          </div>
        );
      case 'radio':
      default:
        return (
          <div className="radio-group vertical">
            {qData.answers.map((ans, i) => (
              <label key={i}>
                <input
                  type="radio" name={qName} value={ans} onChange={handleChange}
                  checked={formData[qName] === ans}
                /> {ans}
              </label>
            ))}
          </div>
        );
    }
  };

  return (
    <React.Fragment>
      <div className={`question-block ${validationErrors.includes(name) ? 'error' : ''}`}>
        <label>
          {displayNumber} {data.question}
          {qConfig.required && <span className="required-asterisk">*</span>}
        </label>
        {renderInput(qConfig)}
      </div>

      {qConfig.key === "Q27" && isQ27No && (
        <>
          {!q27VideoConfirmed && showQ27VideoPrompt && (
            <div className="video-prompt-container">
              <p className="video-prompt-note">{t('ui.videoPrompt.note')}</p>
              <button
                type="button"
                className="video-prompt-button"
                onClick={() => setQ27VideoConfirmed(true)}
              >
                {t('ui.videoPrompt.button')}
              </button>
            </div>
          )}
          {q27VideoConfirmed && qConfig.videoUrlOnNo && (
            <div className="video-container">
              <video width="100%" controls autoPlay src={qConfig.videoUrlOnNo} title={t('ui.videoPrompt.videoTitle')} style={{ borderRadius: 8, maxHeight: 400 }}>
                Your browser does not support the video tag.
              </video>
            </div>
          )}
        </>
      )}
    </React.Fragment>
  );
};

// Custom Comparator
const arePropsEqual = (prev, next) => {
  const name = next.qConfig.name || next.qConfig.key;

  // 1. Check strict dependencies (including i18n)
  if (prev.t !== next.t) return false; // FIX: Language change detection
  if (prev.questionnaireData !== next.questionnaireData) return false; // FIX: Data change

  if (prev.qConfig !== next.qConfig) return false;
  if (prev.displayNumber !== next.displayNumber) return false;
  if (prev.validationErrors.includes(name) !== next.validationErrors.includes(name)) return false;

  if (prev.randomPatientId !== next.randomPatientId) return false; // FIX: Q44 dependency
  if (prev.hospitals !== next.hospitals) return false;

  // 2. Check value change
  if (prev.formData[name] !== next.formData[name]) return false;

  // 3. Check Q27 specifics
  if (name === 'Q27') {
    if (prev.isQ27No !== next.isQ27No) return false;
    if (prev.showQ27VideoPrompt !== next.showQ27VideoPrompt) return false;
    if (prev.q27VideoConfirmed !== next.q27VideoConfirmed) return false;
  }

  // 4. Subquestions check
  // Removed recursive subquestions check because QuestionBlock no longer renders them.
  // Instead, Questionnaire.jsx handles the tree.

  // 5. Other specify field check
  if (next.qConfig.otherOptionId) {
    const otherKey = next.qConfig.otherOptionId;
    if (prev.formData[otherKey] !== next.formData[otherKey]) return false;
    // Also check if the "Other" selection itself changed, though it's likely covered by name
  }

  // 6. Check if English form data changed for this question (affects "Other" visibility)
  if (prev.formDataEn[name] !== next.formDataEn[name]) return false;

  return true;
};

export default memo(QuestionBlock, arePropsEqual);
