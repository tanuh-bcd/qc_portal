import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StyleSheet, 
  Image,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useTranslation } from 'react-i18next';
import QuestionBlock from './QuestionBlock';

const generateRandomId = (length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

function Questionnaire({ onSubmit, isSubmitting, formStructure, questionnaireData, questionnaireDataEn }) {
  const { t } = useTranslation('questionnaire');
  const ui = t('ui', { returnObjects: true });

  const [formData, setFormData] = useState(() => ({
    Q45: t('ui.defaults.q45')
  }));
  const [formDataEn, setFormDataEn] = useState(() => ({
    Q45: 'Universal'
  }));
  const [validationErrors, setValidationErrors] = useState([]);
  const [showQ27VideoPrompt, setShowQ27VideoPrompt] = useState(false); 
  const [q27VideoConfirmed, setQ27VideoConfirmed] = useState(false);
  const [randomPatientId, setRandomPatientId] = useState('');
  
  const getTranslatedConditionValue = useCallback((condition) => {
    if (!condition || !condition.key || !condition.value) return null;
    const enAnswers = questionnaireDataEn[condition.key]?.answers;
    if (!Array.isArray(enAnswers)) return null;
    const index = enAnswers.indexOf(condition.value);
    if (index === -1) return null;
    const translatedAnswers = questionnaireData[condition.key]?.answers;
    return translatedAnswers?.[index] || enAnswers[index];
  }, [questionnaireData, questionnaireDataEn]);

  useEffect(() => {
    const newId = generateRandomId();
    setRandomPatientId(newId);
    setFormData(prevData => ({
      ...prevData,
      Q44: newId,
      Q45: t('ui.defaults.q45')
    }));
  }, [t]);

  const progress = useMemo(() => {
    if (!Array.isArray(formStructure)) return 0;
    const getVisibleQuestionKeys = (currentFormData) => {
      const visibleKeys = new Set();
      const traverse = (questions) => {
          if (!Array.isArray(questions)) return;
          questions.forEach(q => {
              const qKey = q.name || q.key;
              visibleKeys.add(qKey); 
              if (q.otherOptionId) visibleKeys.add(q.otherOptionId);
              if (q.subQuestions && q.condition) {
                  const translatedConditionValue = getTranslatedConditionValue(q.condition);
                  if (currentFormData[q.condition.key] === translatedConditionValue) {
                      traverse(q.subQuestions);
                  }
              }
          });
      };
      formStructure.forEach(section => traverse(section.questions));
      return visibleKeys;
    };
    const visibleKeysSet = getVisibleQuestionKeys(formData);
    let answeredCount = 0;
    visibleKeysSet.forEach(key => {
        const value = formData[key];
        if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) {
            answeredCount++;
        }
    });
    return Math.round((answeredCount / visibleKeysSet.size) * 100);
  }, [formStructure, formData, getTranslatedConditionValue]);

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    // We would also need to update formDataEn here if we want to maintain the same logic
  };

  const handleSubmit = () => {
    // In React Native, we call the onSubmit prop directly
    onSubmit(formData);
  };

  if (!Array.isArray(formStructure) || !ui.header || !questionnaireData.Q1) {
    return (
        <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0000ff" />
            <Text>Loading questionnaire content...</Text>
        </View>
    );
  }

  let questionCounter = 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.progressContainer}>
        <Text style={styles.progressLabel}>{ui.progressBarTemplate.replace('{progress}', progress)}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </View>

      <View style={styles.formContainer}>
        <Image source={require('../assets/tanuh.png')} style={styles.logo} resizeMode="contain" />
        <Image source={require('../assets/IISc_logo.png')} style={styles.logo} resizeMode="contain" />
        
        <View style={styles.header}>
          <Text style={styles.title}>{t('ui.header.title')}</Text>
          <Text style={styles.instructions}>{t('ui.header.instructions')}</Text>
          <Text style={styles.mandatoryText}>
            {t('ui.header.mandatoryPre')}
            <Text style={styles.requiredAsterisk}>{t('ui.header.mandatorySymbol')}</Text>
            {t('ui.header.mandatoryPost')}
          </Text>
        </View>

        {formStructure.map((section, index) => (
          <View key={index} style={styles.section}>
            <Text style={styles.sectionTitle}>{t(section.title)}</Text>
            {section.questions.map((qConfig) => {
              const data = questionnaireData[qConfig.key];
              if (!data) return null;
              
              if (qConfig.condition && qConfig.condition.key !== qConfig.key) {
                if (formDataEn[qConfig.condition.key] !== qConfig.condition.value) {
                  return null;
                }
              }

              questionCounter++;
              const displayNumber = `${questionCounter}.`;
              const name = qConfig.name || qConfig.key;
              
              return (
                <QuestionBlock
                  key={name}
                  qConfig={qConfig}
                  questionnaireData={questionnaireData}
                  questionnaireDataEn={questionnaireDataEn}
                  formData={formData}
                  formDataEn={formDataEn}
                  validationErrors={validationErrors}
                  handleChange={handleChange}
                  t={t}
                  displayNumber={displayNumber}
                  randomPatientId={randomPatientId}
                />
              );
            })}
          </View>
        ))}

        <TouchableOpacity 
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]} 
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{t('ui.submitButton.default')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    padding: 15,
    backgroundColor: '#f8f9fa',
  },
  progressLabel: {
    fontSize: 14,
    marginBottom: 5,
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#e9ecef',
    borderRadius: 4,
  },
  progressFill: {
    height: 8,
    backgroundColor: '#007bff',
    borderRadius: 4,
  },
  formContainer: {
    padding: 20,
  },
  logo: {
    width: 150,
    height: 60,
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: '#533b42',
    textAlign: 'center',
    marginTop: 8,
  },
  mandatoryText: {
    fontSize: 14,
    color: '#533b42',
    marginTop: 8,
  },
  requiredAsterisk: {
    color: '#d93025',
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 5,
  },
  submitButton: {
    backgroundColor: '#007bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default Questionnaire;
