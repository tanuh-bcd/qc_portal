import React from 'react';
import './ThankYou.css';
import jsPDF from 'jspdf';
import { Download, CheckCircle } from 'lucide-react';
import thankYouData from '../assets/locales/english/thankyou.json';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import RiskTable from './RiskTable';


const getRiskLevel = (score, t) => {
    const rows = t('interpretation.data', { returnObjects: true });
    const levels = Array.isArray(rows) ? rows.map(r => r.level) : ["Baseline Risk", "Evident Risk", "Significant Risk", "High Risk"];

    const numScore = parseFloat(score);
    if (isNaN(numScore)) return null;
    if (numScore < 0.4004) return levels[0];
    if (numScore >= 0.4004 && numScore < 0.574) return levels[1];
    if (numScore >= 0.574 && numScore < 0.795) return levels[2];
    if (numScore >= 0.795) return levels[3];
    return null;
};


const getRiskLevelEn = (score) => {
    const numScore = parseFloat(score);
    if (isNaN(numScore)) return null;
    if (numScore < 0.4004) return "Baseline Risk";
    if (numScore >= 0.4004 && numScore < 0.574) return "Evident Risk";
    if (numScore >= 0.574 && numScore < 0.795) return "Significant Risk";
    if (numScore >= 0.795) return "High Risk";
    return null;
};

const Riskometer = ({ riskLevel }) => {
    const [needleRotation, setNeedleRotation] = useState(-90);

    useEffect(() => {
        const timer = setTimeout(() => {
            const angles = {
                "Baseline Risk": -67.5,
                "Evident Risk": -22.5,
                "Significant Risk": 22.5,
                "High Risk": 67.5
            };
            setNeedleRotation(angles[riskLevel] || 67.5);
        }, 800);
        return () => clearTimeout(timer);
    }, [riskLevel]);

    return (
        <div className="riskometer-container fade-in">
            <div className="riskometer-gauge">
                <div className="gauge-background"></div>
                <div className="riskometer-needle" style={{ transform: `rotate(${needleRotation}deg)` }}></div>
                <div className="riskometer-center"></div>
            </div>
            <div className="gauge-labels">
                <span className={riskLevel === "Baseline Risk" ? "active-level" : ""}>Baseline</span>
                <span className={riskLevel === "Evident Risk" ? "active-level" : ""}>Evident</span>
                <span className={riskLevel === "Significant Risk" ? "active-level" : ""}>Significant</span>
                <span className={riskLevel === "High Risk" ? "active-level" : ""}>High</span>
            </div>
        </div>
    );
};


// const getRiskActionEn = (score) => {
//     const numScore = parseFloat(score);
//     if (isNaN(numScore)) return null;
//     if (numScore < 0.4004) return "Keep up with routine checkups, like yearly breast exams by a doctor from 30 years of age.";
//     if (numScore >= 0.4004 && numScore < 0.574) return "Consider breast exams every 6 months from 30 years of age and talk to your doctor about prevention.";
//     if (numScore >= 0.574 && numScore < 0.795) return "Get breast exams every 4-6 months from 25 years of age and possibly imaging (like mammograms) as advised by your doctor.";
//     if (numScore >= 0.795) return "Be extra vigilant with breast exams every 4 months from at least 25 years of age and more frequent imaging as per your doctor's advice.";
//     return null;
// };

function ThankYou({ riskResult, formData, sessionId, formStructure, questionnaireData }) {

    const { t: tThankYou } = useTranslation('thankyou');
    // const { t: tQuestions } = useTranslation('questionnaire');
    // const pdfContentRef = useRef(null); // Ref for the hidden HTML content
    
    // // NEW: Ref to track the main question number across sections
    // const mainQuestionCounterRef = useRef(0);

    const score = riskResult !== null ? (parseFloat(riskResult) / 100).toFixed(2) : null;
    const isMale = formData?.Q47 === 'Male';
    const riskInterpretationData = tThankYou('interpretation.data', { returnObjects: true }) || [];
    const riskInterpretationDataEn = thankYouData.interpretation.data || [];

    const userRiskLevel = score !== null ? getRiskLevel(score, tThankYou) : null;
    const userRiskLevelEn = score !== null ? getRiskLevelEn(score) : null;

    useEffect(() => {
        console.log("=== RISK SCORE (normalized 0–1) ===", score);
        console.log("=== RISK SCORE (percentage input) ===", riskResult);
        console.log("=== RISK LEVEL (Translated) ===", userRiskLevel);
        console.log("=== RISK LEVEL (English) ===", userRiskLevelEn);
    }, [score, userRiskLevel, userRiskLevelEn]);
    // const userRiskAction = score !== null ? getRiskAction(score, tThankYou) : null;
    // const userRiskActionEn = score !== null ? getRiskActionEn(score) : null;

   

    const handleDownloadPdf = () => {
        if (!formData) {
            // --- MODIFIED ---
            alert(thankYouData.pdf.alertNoData);
            return;
        }

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        let y = 0;

        const themeColor = [20, 134, 140];


        const sanitizeText = (text) => {
            if (!text) return '';
            return text.replace(/₹/g, 'Rs.').replace(/\s+/g, ' ').trim();
        };

        const addHeader = () => {
            doc.setFillColor(242, 237, 255);
            doc.rect(0, 0, margin + 5, pageHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(40, 40, 40);
            // --- MODIFIED ---
            doc.text(thankYouData.pdf.mainTitle, margin + 10, 18);
            doc.setDrawColor(...themeColor);
            doc.setLineWidth(0.4);
            doc.line(margin + 10, 20, pageWidth - margin, 20);
            y = 32;
        };

        const addFooter = (pageNumber, totalPages) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(150);
            // --- MODIFIED ---
            const footerText = `${thankYouData.pdf.footerPage} ${pageNumber} | ${thankYouData.pdf.footerGenerated}: ${new Date().toLocaleDateString()}`;
            doc.text(footerText, pageWidth / 2, pageHeight - 8, { align: 'center' });
        };

        const addPageWithTemplate = () => {
           const currentPage = doc.internal.getNumberOfPages();
           const totalPagesGuess = currentPage + 1;
           addFooter(currentPage, totalPagesGuess);
           doc.addPage();
           addHeader();
        };

        const renderSectionHeader = (title) => {
            if (y > pageHeight - 30) addPageWithTemplate();
            y += 10;
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...themeColor);
            doc.text(title, margin + 10, y);
            y += 10;
        };

        // --- Q&A Rendering Logic --- (Unchanged, but text is now from JSON)
        const renderQAPair = (questionObject, answerText) => {
            const qaMargin = margin + 15;
            const boxX = margin + 10;
            const boxWidth = pageWidth - (margin * 2) - 10;
            const textWidth = boxWidth - 16; 

            const questionTitleAndBody = sanitizeText(`${questionObject.title || ''} ${questionObject.text || ''}`);
            // --- MODIFIED ---
            const answer = sanitizeText(`${thankYouData.pdf.answerPrefix} ${answerText || ''}`);

            const questionFontSize = 9; 
            const answerFontSize = 9;

            doc.setFont('helvetica', 'bold'); 
            doc.setFontSize(questionFontSize);
            const questionLines = doc.splitTextToSize(questionTitleAndBody, textWidth);
            const questionHeight = doc.getTextDimensions(questionLines, {fontSize: questionFontSize}).h;

            doc.setFont('helvetica', 'normal'); 
            doc.setFontSize(answerFontSize);
            const answerLines = doc.splitTextToSize(answer, textWidth - 5); 
            const answerHeight = doc.getTextDimensions(answerLines, {fontSize: answerFontSize}).h;

            const boxPaddingVertical = 8;
            const spaceBetweenQA = 4; 

            const contentHeight = questionHeight + spaceBetweenQA + answerHeight;
            const totalBoxHeight = contentHeight + (boxPaddingVertical * 2);

            if (y + totalBoxHeight > pageHeight - 20) {
                addPageWithTemplate();
            }

            doc.setFillColor(253, 253, 253);
            doc.setDrawColor(225, 225, 225);
            doc.setLineWidth(0.2);
            doc.roundedRect(boxX, y, boxWidth, totalBoxHeight, 3, 3, 'FD');

            let textY = y + boxPaddingVertical; 

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(questionFontSize);
            doc.setTextColor(50, 50, 50);
            doc.text(questionLines, qaMargin, textY + 3); 
            textY += questionHeight + spaceBetweenQA;

            doc.setFont('helvetica', 'normal'); 
            doc.setFontSize(answerFontSize);
            doc.setTextColor(80, 80, 80);
            doc.text(answerLines, qaMargin + 5, textY + 3); 

            y += totalBoxHeight + 8; 
        };


        // --- START PDF GENERATION ---
        addHeader();

        // --- 1. RENDER RISK SCORE ---
        if (score !== null) {
          doc.setFillColor(240, 230, 255);
          doc.roundedRect(margin + 10, y, pageWidth - (margin * 2) - 10, 22, 3, 3, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(40, 40, 40);
          // --- MODIFIED ---
          doc.text(thankYouData.riskScoreLabel, margin + 15, y + 13);
          doc.setFontSize(20); doc.setTextColor(...themeColor);
          doc.text(`${userRiskLevelEn}`, pageWidth - margin - 15, y + 15, { align: 'right' });
          y += 32;
        }

        if (score !== null) {
            if (y > pageHeight - 60) addPageWithTemplate();

            // --- NEW SECTION: "What To Do" ---
            renderSectionHeader(thankYouData.interpretation.headers.action);

            // Find the highlighted (user) row
            const highlightedRow = riskInterpretationDataEn.find(
                (row) => row.level === userRiskLevelEn
            );

            // Add box styling
            const boxX = margin + 10;
            const boxWidth = pageWidth - margin * 2 - 20;
            const boxPadding = 6;
            const boxLineSpacing = 4;
            const actionText = highlightedRow
                ? highlightedRow.action
                : "No specific action available.";

            // Split long text
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            const wrappedText = doc.splitTextToSize(actionText, boxWidth - boxPadding * 2);
            const boxHeight =
                doc.getTextDimensions(wrappedText, { fontSize: 10 }).h + boxPadding * 2;

            // Check for page overflow
            if (y + boxHeight > pageHeight - 40) addPageWithTemplate();

            // Draw shaded box
            doc.setFillColor(245, 245, 255);
            doc.setDrawColor(180, 180, 200);
            doc.setLineWidth(0.3);
            doc.roundedRect(boxX, y, boxWidth, boxHeight, 3, 3, 'FD');

            // Write the action text inside
            doc.setTextColor(50, 50, 70);
            doc.text(
                wrappedText,
                boxX + boxPadding,
                y + boxPadding + boxLineSpacing
            );

            y += boxHeight + 10;
        }


        // --- ADD DISCLAIMER TEXT (Corrected for Width) ---
        if (y > pageHeight - 40) addPageWithTemplate(); 
        const disclaimerX = margin + 10;
        const disclaimerY = y + 5; 
        const redColor = [224, 57, 68]; 
        const disclaimerFontSize = 9;
        // --- MODIFIED ---
        const disclaimerText = thankYouData.disclaimer.text;
        
        // Draw Asterisk in Red
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(disclaimerFontSize + 1);
        doc.setTextColor(redColor[0], redColor[1], redColor[2]);
        // --- MODIFIED ---
        doc.text(thankYouData.disclaimer.asterisk, disclaimerX, disclaimerY);

        // Draw "Disclaimer:" in Bold Grey
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(disclaimerFontSize);
        doc.setTextColor(100, 100, 100);
        // --- MODIFIED ---
        const disclaimerLabel = `${thankYouData.disclaimer.title}:`;
        const disclaimerLabelWidth = doc.getTextWidth(disclaimerLabel);
        doc.text(disclaimerLabel, disclaimerX + 2, disclaimerY);
        
        const textStartX = disclaimerX + 2 + disclaimerLabelWidth + 2; 
        const availableTextWidth = pageWidth - textStartX - margin; 

        // Draw main disclaimer text in normal grey, with correct wrapping
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        const disclaimerLines = doc.splitTextToSize(disclaimerText, availableTextWidth);
        doc.text(disclaimerLines, textStartX, disclaimerY);
        
        const disclaimerHeight = doc.getTextDimensions(disclaimerLines, {fontSize: disclaimerFontSize}).h;
        y += disclaimerHeight + 10; 
        // --- END OF DISCLAIMER ADDITION ---

        // --- 3. RENDER Q&A DATA (Logic 100% Unchanged) ---

        // ***** THIS IS THE FIX *****
        // We check if 'questionnaireData' has a 'questions' key.
        // If yes, we use that. If no, we use 'questionnaireData' directly.
        const questionsObject = (questionnaireData && questionnaireData.questions) ? questionnaireData.questions : questionnaireData;
        // ***************************

        let mainQuestionCounter = 0;
        formStructure.forEach((section) => {
            const questionsToRender = [];
            const findAnsweredQuestions = (questions, parentNumber) => {
                questions.forEach((qConfig, index) => {
                    const name = qConfig.name || qConfig.key; const answer = formData[name];
                    let displayNumber;
                    if (parentNumber) displayNumber = `${parentNumber}${String.fromCharCode(97 + index)}`;
                    else { mainQuestionCounter++; displayNumber = mainQuestionCounter; }
                    
                    // Check if 'questionsObject' is valid before trying to access it
                    const questionText = questionsObject ? questionsObject[qConfig.key]?.question : '';

                    if (answer !== undefined && answer !== null && answer !== '' && (!Array.isArray(answer) || answer.length > 0)) {
                        questionsToRender.push({
                            questionObject: {
                                // --- MODIFIED (Text only) ---
                                title: `${thankYouData.pdf.questionPrefix} ${displayNumber}:`,
                                // --- MODIFIED: Use the 'questionsObject' we defined above ---
                                text: questionText
                            },
                            answer: Array.isArray(answer) ? answer.join(', ') : answer.toString(),
                        });
                    }
                    if (qConfig.subQuestions && qConfig.condition && formData[qConfig.condition.key] === qConfig.condition.value) {
                        findAnsweredQuestions(qConfig.subQuestions, displayNumber);
                    }
                });
            };
            findAnsweredQuestions(section.questions);

            if (questionsToRender.length > 0) {
                renderSectionHeader(section.title);
                questionsToRender.forEach((qa) => renderQAPair(qa.questionObject, qa.answer));
            }
        });

        // Add footers to all pages
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            addFooter(i, totalPages);
        }

        // --- MODIFIED ---
        doc.save(`${thankYouData.pdf.fileNamePrefix}-${sessionId || 'UnknownSession'}.pdf`);
    };

    // --- JSX Return ---
    return (
    <div className="thank-you-overlay">
      <div className="thank-you-dialog">
        <button className="close-button" onClick={() => window.location.reload()}>&times;</button>

        <div className="demo-result-header-centered">
          <div className="thank-you-header">
            <CheckCircle className="success-icon" size={48} />
            <h3>{tThankYou('title')}</h3>
          </div>
          <p className="demo-thank-you-msg">{tThankYou('message')}</p>

          {isMale && (
            <div className="male-disclaimer-container">
              <p className="male-disclaimer-text">
                {tThankYou('maleDisclaimer')}
              </p>
            </div>
          )}

          {score !== null && !isMale && (
            <div className="demo-risk-status-hero">
              <h2 className="risk-status-text">{userRiskLevel}</h2>
            </div>
          )}
        </div>

        {score !== null && !isMale && (
            <Riskometer riskLevel={userRiskLevelEn || userRiskLevel} />
        )}

        {score !== null && !isMale && (() => {
            const highlightedRow = riskInterpretationData.find(
                (row) => row.level === userRiskLevel
            );

            return (
                <div className="what-to-do-container">
                <h4 className="what-to-do-title">{tThankYou('interpretation.headers.action')}</h4>

                {highlightedRow ? (
                    <div className="what-to-do-box">
                    <p className="what-to-do-text">{highlightedRow.action}</p>
                    </div>
                ) : (
                    <p className="no-data-text">{tThankYou('noActionData', { defaultValue: 'No specific action available.' })}</p>
                )}
                </div>
            );
        })()}

        {score !== null && !isMale && (
            <div style={{ width: '100%' }}>
              <RiskTable />
            </div>
        )}

        <p className="disclaimer-text" style={{ textAlign: 'left', marginTop: '20px', marginBottom: '30px' }}>
          <span className="disclaimer-asterisk">{tThankYou('disclaimer.asterisk')}</span>
          <strong>{tThankYou('disclaimer.title')}</strong>:
          {' '}{tThankYou('disclaimer.text')}
        </p>

        <div className="action-buttons">
          <button className="ok-button" onClick={() => window.location.reload()}>
            {tThankYou('buttons.ok')}
          </button>
          <button className="download-button" onClick={handleDownloadPdf}>
            <Download size={18} style={{ marginRight: '8px' }} />
            {tThankYou('buttons.download')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThankYou;
