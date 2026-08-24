import React, { useState, useRef } from 'react';
import './Consent.css';
import { useTranslation } from 'react-i18next';
import { Camera, Upload, X, RefreshCw } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';

function Consent({ onAccept }) {
  const [isChecked, setIsChecked] = useState(false);
  const [scannedFile, setScannedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const { t } = useTranslation('consent');
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = async (currentFacingMode = facingMode) => {
    setCameraError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: currentFacingMode } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCameraError('Could not access camera. Please ensure permissions are granted or use the upload option.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const switchCamera = () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    if (isCameraActive) {
      startCamera(newMode);
    }
  };

  const capturePhoto = () => {
    console.log('Capture button clicked');
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('Video dimensions are not yet available.');
        // Retry once after a short delay if dimensions are 0
        setTimeout(() => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            capturePhoto();
          } else {
            console.error('Video dimensions still 0 after retry');
          }
        }, 500);
        return;
      }

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      console.log('Canvas dimensions set to:', canvas.width, 'x', canvas.height);
      
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      console.log('Image drawn to canvas');

      try {
        // Fallback approach: Use toDataURL if toBlob has issues, or just as a more immediate way to get the data
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        console.log('Data URL generated, length:', dataUrl.length);
        
        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            console.log('toBlob callback executed, blob:', blob);
            if (blob) {
              const file = new File([blob], `captured-consent-${Date.now()}.jpg`, { type: 'image/jpeg' });
              console.log('File created from blob:', file.name, file.size, 'bytes');
              setScannedFile(file);
              // Small delay before stopping camera to ensure state update is processed
              setTimeout(() => stopCamera(), 100);
            } else {
              console.error('Blob creation failed: blob is null. Using DataURL fallback.');
              handleDataUrl(dataUrl);
            }
          }, 'image/jpeg', 0.9);
        } else {
          console.warn('canvas.toBlob not supported, using DataURL.');
          handleDataUrl(dataUrl);
        }
      } catch (err) {
        console.error('Error during capture process:', err);
      }
    } else {
      console.error('videoRef or canvasRef is null', { video: !!videoRef.current, canvas: !!canvasRef.current });
    }
  };

  const handleDataUrl = (dataUrl) => {
    try {
      // Convert dataURL to File object
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const file = new File([u8arr], `captured-consent-${Date.now()}.jpg`, { type: mime });
      console.log('File created from DataURL:', file.name, file.size, 'bytes');
      setScannedFile(file);
      setTimeout(() => stopCamera(), 100);
    } catch (e) {
      console.error('Error converting DataURL to File:', e);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Create a new File object with a cleaner name if it's from a camera/generic source
      const fileName = file.name || `upload-${Date.now()}.jpg`;
      setScannedFile(file);
    }
  };

  const handleAccept = async () => {
    setIsUploading(true);

    try {
      const token = localStorage.getItem('token');

      if (token) {
        const apiUrl = process.env.REACT_APP_API_URL || '';
        const formData = new FormData();
        if (scannedFile) {
          formData.append('file', scannedFile);
        }
        const response = await fetch(`${apiUrl}/api/v1/patient/consent`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        if (response.ok) {
          const result = await response.json();
          onAccept(result);
        } else {
          const errorData = await response.json();
          alert(`Upload failed: ${errorData.detail || 'Unknown error'}`);
        }
      } else {
        onAccept({ file: scannedFile || null });
      }
    } catch (error) {
      console.error('Error uploading consent:', error);
      alert('An error occurred while uploading the consent form.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="consent-container">
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <img src="/tanuh.png" alt="TANUH Logo" style={{ height: 55, objectFit: 'contain' }} />
        <img src="/MoE_Logo.svg" alt="MoE Logo" style={{ height: 45, objectFit: 'contain' }} />
        <img src="/IISc_logo.png" alt="IISc Logo" style={{ height: 60, objectFit: 'contain' }} />
      </div>
      <LanguageSwitcher />
      <div className="language-switch-container">
        {isCameraActive && (
          <button type="button" className="switch-camera-btn" onClick={switchCamera}>
            <RefreshCw size={20} />
            {t('switchCamera') || 'Switch Camera'}
          </button>
        )}
      </div>
      
      <h2>{t('title')}</h2>
      
      <div className="consent-header">
        <p><strong>{t('headernames.studyTitle')} :</strong> {t('header.studyTitle')}</p>
        <p><strong>{t('headernames.sponsor')} :</strong> {t('header.sponsor')}</p>
        <p><strong>{t('headernames.iecApproval')} :</strong> {t('header.iecApproval')}</p>
      </div>

      {t('sections', { returnObjects: true }).map((section, idx) => (
        <div key={idx} className={section.className ? section.className : 'consent-section'}>
          <h3>{section.heading}</h3>
          {section.paragraphs.map((para, pIdx) => (
            <p key={pIdx} className={para.className || undefined}>
              {para.strong && <strong>{para.strong} </strong>}
              {para.text}
            </p>
          ))}
        </div>
      ))}

      <div className="consent-upload">
        <strong className="consent-upload-title">Consent Upload</strong>
        {!isCameraActive && !scannedFile && (
          <div className="upload-options">
            <button type="button" className="action-button camera-btn" onClick={startCamera}>
              <Camera size={20} />
              {t('takePhoto') || 'Take Photo'}
            </button>
            <button type="button" className="action-button upload-btn" onClick={() => document.getElementById('consent-file').click()}>
              <Upload size={20} />
              {t('uploadImage') || 'Upload Image'}
            </button>
            <input
              type="file"
              id="consent-file"
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {isCameraActive && (
          <div className="camera-preview-container">
            <video ref={videoRef} autoPlay playsInline className="camera-video" />
            <div className="camera-controls">
              <button type="button" className="action-button capture-btn" onClick={capturePhoto}>
                <div className="capture-inner" />
              </button>
              <button type="button" className="action-button close-btn" onClick={stopCamera}>
                <X size={24} />
              </button>
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        )}

        {cameraError && <p className="camera-error">{cameraError}</p>}

        {scannedFile && (
          <div className="selected-file-container">
            <p className="file-name">{scannedFile.name}</p>
            <button type="button" className="action-button retake-btn" onClick={() => {
              setScannedFile(null);
              startCamera();
            }}>
              <RefreshCw size={16} />
              {t('retake') || 'Retake'}
            </button>
            <button type="button" className="action-button remove-file-btn" onClick={() => setScannedFile(null)}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="consent-checkbox">
        <input
          type="checkbox"
          id="consent-check"
          checked={isChecked}
          onChange={() => setIsChecked(!isChecked)}
        />
        <label htmlFor="consent-check">{t('checkboxLabel')}</label>
      </div>

      <button 
        className="consent-button" 
        onClick={handleAccept} 
        disabled={!isChecked || isUploading}
      >
        {isUploading ? (t('uploadingText') || 'Uploading...') : t('buttonText')}
      </button>
    </div>
  );
}

export default Consent;
