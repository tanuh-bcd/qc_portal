import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown, Check } from 'lucide-react';
import './LanguageSwitcher.css';

const languages = [
  { code: 'english', name: 'English' },
  { code: 'hindi', name: 'हिन्दी' },
  { code: 'telugu', name: 'తెలుగు' },
  { code: 'kannada', name: 'ಕನ್ನಡ' },
  { code: 'tamil', name: 'தமிழ்' },
  { code: 'malayalam', name: 'മലയാളം' },
  { code: 'bengali', name: 'বাংলা' },
  { code: 'marathi', name: 'मराठी' },
  { code: 'gujarati', name: 'ગુજરાતી' },
  { code: 'punjabi', name: 'ਪੰਜਾਬੀ' },
  { code: 'odia', name: 'ଓଡ଼ିଆ' },
];

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  const changeLanguage = (code) => {
    i18n.changeLanguage(code);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="language-switcher-wrapper">
      <div className="language-switcher-container" ref={dropdownRef}>
        <button
          className={`lang-select-button ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <div className="lang-button-left">
            <Globe size={16} className="globe-icon" />
            <span className="lang-button-text">
              Select Language <span className="current-lang-hint">- {currentLang.name}</span>
            </span>
          </div>
          <ChevronDown size={14} className="chevron-icon" />
        </button>

        {isOpen && (
          <ul className="lang-dropdown-menu" role="listbox">
            {languages.map((lang) => (
              <li
                key={lang.code}
                role="option"
                aria-selected={i18n.language === lang.code}
                className={`lang-option ${i18n.language === lang.code ? 'selected' : ''}`}
                onClick={() => changeLanguage(lang.code)}
              >
                <span className="lang-name">{lang.name}</span>
                {i18n.language === lang.code && <Check size={14} className="check-icon" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LanguageSwitcher;
