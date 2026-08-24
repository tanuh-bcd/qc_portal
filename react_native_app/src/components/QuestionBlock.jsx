import React, { memo } from 'react';
import { View, Text, TextInput, StyleSheet, Switch } from 'react-native';
// In a real app, you'd use a picker library like @react-native-picker/picker
// For this blueprint, we'll use a placeholder or basic components

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
  randomPatientId,
}) => {
  const name = qConfig.name || qConfig.key;
  const data = questionnaireData[qConfig.key];

  if (!data) return <Text>{t('ui.errors.questionNotFound', { key: qConfig.key })}</Text>;

  const renderInput = (config) => {
    const qName = config.name || config.key;
    const qData = questionnaireData[config.key];
    if (!qData) return null;

    let placeholder = config.placeholder || '';
    if (config.key === 'Q44') {
      placeholder = randomPatientId;
    }

    if (!Array.isArray(qData.answers) || qData.answers.length === 0) {
      return (
        <View>
          <TextInput
            style={styles.textInput}
            placeholder={placeholder}
            value={formData[qName] || ''}
            onChangeText={(text) => handleChange(qName, text)}
            keyboardType={config.type === 'number' ? 'numeric' : 'default'}
          />
          {validationErrors.includes(qName) && (
            <Text style={styles.errorText}>
              {config.min !== undefined && config.max !== undefined
                ? `${t('ui.invalidInput.numberPrefix')} ${config.min} ${t('ui.invalidInput.and')} ${config.max}.`
                : `${t('ui.invalidInput.validInput')} `}
            </Text>
          )}
        </View>
      );
    }

    // Basic representation of selection/checkboxes in React Native
    // In production, use @react-native-picker/picker or custom radio buttons
    return (
      <View style={styles.answersContainer}>
        {qData.answers.map((ans, i) => (
          <View key={i} style={styles.answerRow}>
            {/* Simple representation of a selection/radio */}
            <Text 
              style={[styles.answerText, formData[qName] === ans && styles.selectedAnswer]}
              onPress={() => handleChange(qName, ans)}
            >
              {ans}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.blockContainer}>
      <Text style={styles.questionLabel}>
        <Text style={styles.displayNumber}>{displayNumber}</Text> {data.question}
        {qConfig.required && <Text style={styles.requiredAsterisk}>*</Text>}
      </Text>
      
      {renderInput(qConfig)}
    </View>
  );
};

const styles = StyleSheet.create({
  blockContainer: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#fff',
  },
  questionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  displayNumber: {
    fontWeight: 'bold',
  },
  requiredAsterisk: {
    color: '#d93025',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
  },
  errorText: {
    color: '#d93025',
    fontSize: 12,
    marginTop: 5,
  },
  answersContainer: {
    marginTop: 5,
  },
  answerRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  answerText: {
    fontSize: 16,
    color: '#444',
  },
  selectedAnswer: {
    color: '#007bff',
    fontWeight: 'bold',
  }
});

export default memo(QuestionBlock);
