import React from 'react';
import { Globe, Linkedin, Twitter, Youtube } from 'lucide-react';

const Footer = () => {
  const socialLinks = [
    { icon: <Globe size={20} />, url: process.env.REACT_APP_WEBSITE_URL, label: 'Website' },
    { icon: <Linkedin size={20} />, url: process.env.REACT_APP_LINKEDIN_URL, label: 'LinkedIn' },
    { icon: <Twitter size={20} />, url: process.env.REACT_APP_TWITTER_URL, label: 'Twitter' },
    { icon: <Youtube size={20} />, url: process.env.REACT_APP_YOUTUBE_URL, label: 'YouTube' },
  ];

  return (
    <footer style={{
      padding: '40px 20px',
      borderTop: '1px solid #eee',
      backgroundColor: 'transparent',
      color: '#555',
      fontSize: '14px',
      lineHeight: '1.6',
      fontFamily: '"Inter", sans-serif'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '40px',
          width: '100%',
        }}>
          <div style={{ textAlign: 'left' }}>
            <strong style={{ display: 'block', marginBottom: '10px', fontSize: '15px', color: '#14868C' }}>Address</strong>
            AI Centre of Excellence in Healthcare<br />
            Indian Institute of Science<br />
            Seventh Floor, TCS Smart-X Hub<br />
            Bengaluru, India - 560 012
          </div>

          <div style={{ textAlign: 'right' }}>
            <strong style={{ display: 'block', marginBottom: '10px', fontSize: '15px', color: '#14868C' }}>Contact Information</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
              <div>Study: <a href="mailto:breastcancerscreening@tanuh.ai" style={{ color: '#14868C', textDecoration: 'none' }}>breastcancerscreening@tanuh.ai</a></div>
              <div>General: <a href="mailto:info@tanuh.ai" style={{ color: '#14868C', textDecoration: 'none' }}>info@tanuh.ai</a></div>
              <div style={{ marginTop: '6px' }}>
                Tel: (080) 2293 4106 &nbsp;|&nbsp; (080) 2293 4107
              </div>
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: '24px',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '12px 0',
        }}>
          {socialLinks.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#14868C',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: '50%',
                backgroundColor: '#e8f7f8',
                transition: 'all 0.2s',
              }}
              title={link.label}
            >
              {link.icon}
            </a>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #ddd', paddingTop: '16px', width: '100%', fontSize: '12px', textAlign: 'center', color: '#999' }}>
          &copy; 2025 by TANUH Foundation
        </div>
      </div>
    </footer>
  );
};

export default Footer;
