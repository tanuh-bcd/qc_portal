import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, TextInput, Alert } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { createSession, saveResponses, updateSessionRisk, updateConsentPhoto } from '../db/offline-store';
import { calculateSnehithaRisk, getRiskLevel, getRiskColor } from '../services/risk-calculator';
import { syncAll } from '../db/sync-engine';
import { isOnline } from '../services/net-status';
import { useTranslation } from 'react-i18next';
import Questionnaire from '../components/Questionnaire';

const PatientFlow = ({ route, navigation }) => {
  const { clinicId, clinicName } = route.params;
  const { t, ready } = useTranslation(['consent', 'questionnaire', 'thankyou']);
  const [step, setStep] = useState('consent');
  const [sessionId, setSessionId] = useState(null);
  const [consentPhoto, setConsentPhoto] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [riskResult, setRiskResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCaptureConsent = () => {
    launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: false }, (response) => {
      if (response.didCancel || response.errorCode) return;
      const asset = response.assets?.[0];
      if (asset?.uri) {
        setConsentPhoto(asset.uri);
      }
    });
  };

  const handleConsentAccept = async () => {
    const id = await createSession(clinicId, clinicName);
    setSessionId(id);
    if (consentPhoto) {
      await updateConsentPhoto(id, consentPhoto);
    }
    setStep('questionnaire');
  };

  const handleSubmit = async (formData, formDataEn) => {
    if (!sessionId) return;
    setIsSubmitting(true);

    try {
      await saveResponses(sessionId, formDataEn);
      const risk = calculateSnehithaRisk(formDataEn);
      await updateSessionRisk(sessionId, risk);
      setRiskResult(risk);
      setStep('result');

      if (isOnline()) {
        syncAll().catch(() => {});
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to save responses. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNewSession = () => {
    setStep('consent');
    setSessionId(null);
    setConsentPhoto(null);
    setConsentChecked(false);
    setRiskResult(null);
  };

  if (!ready) {
    return <View style={styles.center}><Text>Loading...</Text></View>;
  }

  if (step === 'consent') {
    const consentSections = t('consent:sections', { returnObjects: true });
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Informed Consent</Text>
          <Text style={styles.clinicBadge}>{clinicName}</Text>

          {Array.isArray(consentSections) && consentSections.map((section, idx) => (
            <View key={idx} style={styles.consentSection}>
              {section.heading && <Text style={styles.consentHeading}>{section.heading}</Text>}
              {section.paragraphs?.map((para, pIdx) => (
                <Text key={pIdx} style={styles.consentPara}>
                  {para.strong && <Text style={{ fontWeight: '700' }}>{para.strong} </Text>}
                  {para.text}
                </Text>
              ))}
            </View>
          ))}

          <TouchableOpacity style={styles.cameraButton} onPress={handleCaptureConsent}>
            <Text style={styles.cameraButtonText}>
              {consentPhoto ? 'Retake Consent Photo' : 'Capture Signed Consent'}
            </Text>
          </TouchableOpacity>

          {consentPhoto && (
            <View style={styles.photoPreview}>
              <Image source={{ uri: consentPhoto }} style={styles.previewImage} />
              <Text style={styles.photoLabel}>Consent photo captured</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.checkRow, consentChecked && styles.checkRowActive]}
            onPress={() => setConsentChecked(!consentChecked)}
          >
            <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
              {consentChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{t('consent:checkboxLabel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, !consentChecked && styles.primaryButtonDisabled]}
            onPress={handleConsentAccept}
            disabled={!consentChecked}
          >
            <Text style={styles.primaryButtonText}>Proceed to Questionnaire</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (step === 'questionnaire') {
    const formStructure = t('questionnaire:formStructure', { returnObjects: true });
    const questionnaireData = t('questionnaire:questions', { returnObjects: true });

    return (
      <Questionnaire
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        formStructure={formStructure}
        questionnaireData={questionnaireData}
        questionnaireDataEn={questionnaireData}
      />
    );
  }

  if (step === 'result') {
    const level = getRiskLevel(riskResult);
    const color = getRiskColor(level);
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <View style={[styles.card, { alignItems: 'center' }]}>
          <Text style={{ fontSize: 48, marginBottom: 8 }}>✓</Text>
          <Text style={styles.cardTitle}>Submission Complete</Text>
          <Text style={styles.thankYouText}>Thank you for completing the questionnaire!</Text>

          <View style={[styles.riskBadge, { backgroundColor: color }]}>
            <Text style={styles.riskLevel}>{level}</Text>
            <Text style={styles.riskScore}>{riskResult}%</Text>
          </View>

          <Text style={styles.savedLocally}>
            {isOnline() ? 'Data synced to cloud' : 'Saved locally — will sync when online'}
          </Text>

          <TouchableOpacity style={styles.primaryButton} onPress={handleNewSession}>
            <Text style={styles.primaryButtonText}>Start New Session</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryButtonText}>Back to Clinic Selection</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5FFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, elevation: 3, borderTopWidth: 5, borderTopColor: '#14868C' },
  cardTitle: { fontSize: 22, fontWeight: '700', color: '#14868C', marginBottom: 8, textAlign: 'center' },
  clinicBadge: { textAlign: 'center', color: '#666', fontSize: 14, marginBottom: 20, fontStyle: 'italic' },
  consentSection: { marginBottom: 16 },
  consentHeading: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 6, borderLeftWidth: 3, borderLeftColor: '#14868C', paddingLeft: 10 },
  consentPara: { fontSize: 14, color: '#555', lineHeight: 22, marginBottom: 6 },
  cameraButton: { backgroundColor: '#f0fafb', borderWidth: 2, borderColor: '#14868C', borderStyle: 'dashed', borderRadius: 12, padding: 18, alignItems: 'center', marginVertical: 16 },
  cameraButtonText: { color: '#14868C', fontWeight: '600', fontSize: 15 },
  photoPreview: { alignItems: 'center', marginBottom: 16 },
  previewImage: { width: 200, height: 150, borderRadius: 8, marginBottom: 6 },
  photoLabel: { color: '#14868C', fontSize: 13, fontWeight: '500' },
  checkRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 10, backgroundColor: '#fafbfc', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 16 },
  checkRowActive: { backgroundColor: '#e8f7f8', borderColor: '#14868C' },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#ccc', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#14868C', borderColor: '#14868C' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 14, color: '#333' },
  primaryButton: { backgroundColor: '#14868C', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryButtonDisabled: { backgroundColor: '#ccc' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#14868C', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 10 },
  secondaryButtonText: { color: '#14868C', fontSize: 15, fontWeight: '500' },
  thankYouText: { fontSize: 15, color: '#666', marginBottom: 24, textAlign: 'center' },
  riskBadge: { borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 20, width: '100%' },
  riskLevel: { fontSize: 20, fontWeight: '700', color: '#111' },
  riskScore: { fontSize: 36, fontWeight: '800', color: '#111', marginTop: 4 },
  savedLocally: { fontSize: 13, color: '#888', marginBottom: 24, fontStyle: 'italic' },
});

export default PatientFlow;
