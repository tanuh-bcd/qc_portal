import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enConsent from './assets/locales/english/consent.json';
import enQuestionnaire from './assets/locales/english/questionnaire.json';
import enThankyou from './assets/locales/english/thankyou.json';
import hiConsent from './assets/locales/hindi/consent.json';
import hiQuestionnaire from './assets/locales/hindi/questionnaire.json';
import hiThankyou from './assets/locales/hindi/thankyou.json';
import knConsent from './assets/locales/kannada/consent.json';
import knQuestionnaire from './assets/locales/kannada/questionnaire.json';
import knThankyou from './assets/locales/kannada/thankyou.json';
import taConsent from './assets/locales/tamil/consent.json';
import taQuestionnaire from './assets/locales/tamil/questionnaire.json';
import taThankyou from './assets/locales/tamil/thankyou.json';
import teConsent from './assets/locales/telugu/consent.json';
import teQuestionnaire from './assets/locales/telugu/questionnaire.json';
import teThankyou from './assets/locales/telugu/thankyou.json';
import bnConsent from './assets/locales/bengali/consent.json';
import bnQuestionnaire from './assets/locales/bengali/questionnaire.json';
import bnThankyou from './assets/locales/bengali/thankyou.json';
import guConsent from './assets/locales/gujarati/consent.json';
import guQuestionnaire from './assets/locales/gujarati/questionnaire.json';
import guThankyou from './assets/locales/gujarati/thankyou.json';
import mrConsent from './assets/locales/marathi/consent.json';
import mrQuestionnaire from './assets/locales/marathi/questionnaire.json';
import mrThankyou from './assets/locales/marathi/thankyou.json';
import mlConsent from './assets/locales/malayalam/consent.json';
import mlQuestionnaire from './assets/locales/malayalam/questionnaire.json';
import mlThankyou from './assets/locales/malayalam/thankyou.json';
import orConsent from './assets/locales/odia/consent.json';
import orQuestionnaire from './assets/locales/odia/questionnaire.json';
import orThankyou from './assets/locales/odia/thankyou.json';
import paConsent from './assets/locales/punjabi/consent.json';
import paQuestionnaire from './assets/locales/punjabi/questionnaire.json';
import paThankyou from './assets/locales/punjabi/thankyou.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { consent: enConsent, questionnaire: enQuestionnaire, thankyou: enThankyou },
      hi: { consent: hiConsent, questionnaire: hiQuestionnaire, thankyou: hiThankyou },
      kn: { consent: knConsent, questionnaire: knQuestionnaire, thankyou: knThankyou },
      ta: { consent: taConsent, questionnaire: taQuestionnaire, thankyou: taThankyou },
      te: { consent: teConsent, questionnaire: teQuestionnaire, thankyou: teThankyou },
      bn: { consent: bnConsent, questionnaire: bnQuestionnaire, thankyou: bnThankyou },
      gu: { consent: guConsent, questionnaire: guQuestionnaire, thankyou: guThankyou },
      mr: { consent: mrConsent, questionnaire: mrQuestionnaire, thankyou: mrThankyou },
      ml: { consent: mlConsent, questionnaire: mlQuestionnaire, thankyou: mlThankyou },
      or: { consent: orConsent, questionnaire: orQuestionnaire, thankyou: orThankyou },
      pa: { consent: paConsent, questionnaire: paQuestionnaire, thankyou: paThankyou },
    },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['consent', 'questionnaire', 'thankyou'],
    defaultNS: 'questionnaire',
    interpolation: { escapeValue: false },
  });

export default i18n;
