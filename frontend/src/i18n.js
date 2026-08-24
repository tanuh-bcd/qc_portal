import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import all locale files
const languages = [
  'english', 'hindi', 'telugu', 'kannada', 'tamil', 
  'malayalam', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia'
];

const languageMap = {
  'en': 'english',
  'hi': 'hindi',
  'te': 'telugu',
  'kn': 'kannada',
  'ta': 'tamil',
  'ml': 'malayalam',
  'bn': 'bengali',
  'mr': 'marathi',
  'gu': 'gujarati',
  'pa': 'punjabi',
  'or': 'odia'
};
const namespaces = ['consent', 'questionnaire', 'thankyou'];

const resources = {};

languages.forEach(lang => {
  resources[lang] = {};
  namespaces.forEach(ns => {
    try {
      resources[lang][ns] = require(`./assets/locales/${lang}/${ns}.json`);
    } catch (e) {
      console.error(`Could not load locale file for ${lang}/${ns}`);
    }
  });
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'english',
    debug: false,
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
      lookupQuerystring: 'lang',
      convertDetectedLanguage: (lng) => {
        if (languageMap[lng]) return languageMap[lng];
        if (lng.includes('-')) {
          const short = lng.split('-')[0];
          if (languageMap[short]) return languageMap[short];
        }
        return lng;
      }
    },
    interpolation: {
      escapeValue: false,
    },
    ns: namespaces,
    defaultNS: 'consent'
  });

export default i18n;
