import {
  EMAIL_SUBJECTS,
  renderEmailLayout,
  renderPasswordResetEmail,
  renderResendVerificationEmail,
  renderVerificationEmail,
  sanitizeLogoUrl,
} from './email-templates';

describe('EVO professional email templates', () => {
  const code = '482913';
  const resetToken = 'reset-token-abc123';
  const resetUrl = `https://evostream.tv/creator/auth?mode=reset&token=${resetToken}`;

  describe('verification email', () => {
    const template = renderVerificationEmail(code);

    it('1. uses the professional verification subject', () => {
      expect(template.subject).toBe(EMAIL_SUBJECTS.verification);
      expect(template.subject).toBe('Verify your email — EVO');
    });

    it('2. generates a complete HTML document', () => {
      expect(template.html).toMatch(/^<!DOCTYPE html>/);
      expect(template.html).toContain('<html');
      expect(template.html).toContain('</html>');
      expect(template.html).toContain('width="600"');
      expect(template.html).toContain('max-width:600px');
    });

    it('3. includes EVO branding, online heading, and professional prose', () => {
      expect(template.html).toContain('EVO');
      expect(template.html).toContain('STREAM BEYOND');
      expect(template.html).toContain('Verify your email');
      expect(template.html).toContain('Welcome to EVO.');
      expect(template.html).toContain('never share this verification code');
      expect(template.html).toContain('you can safely ignore this email');
      expect(template.html).toContain('— EVO Team');
      expect(template.html).toContain('© EVO');
      expect(template.html).toContain('Stream Beyond');
    });

    it('4. renders the 6-digit OTP prominently as individual digit cells', () => {
      for (const digit of code.split('')) {
        expect(template.html).toContain(`>${digit}<`);
      }
      expect(template.html).toContain('aria-label="Your EVO verification code"');
      expect(template.html).toMatch(/>\d+</);
    });

    it('5. provides a clean dedicated plain-text alternative', () => {
      expect(template.text).toContain('EVO — Stream Beyond');
      expect(template.text).toContain('Verify your email');
      expect(template.text).toContain('Your EVO verification code is:');
      expect(template.text).toContain(code);
      expect(template.text).toContain('never share this verification code with anyone');
      expect(template.text).toContain('© EVO');
      expect(template.text).toContain('Stream Beyond');
    });

    it('6. contains no JavaScript, external CSS, or localhost/file references', () => {
      expect(template.html).not.toContain('<script');
      expect(template.html).not.toContain('localhost');
      expect(template.html).not.toContain('127.0.0.1');
      expect(template.html).not.toContain('file://');
    });
  });

  describe('resend verification email', () => {
    const template = renderResendVerificationEmail(code);

    it('7. uses the new-code subject and clearly marks the code as new', () => {
      expect(template.subject).toBe(EMAIL_SUBJECTS.resendVerification);
      expect(template.subject).toBe('Your new verification code — EVO');
      expect(template.html).toContain('This is your new verification code.');
      expect(template.text).toContain('This is your new verification code.');
    });

    it('8. reuses the same professional verification template structure', () => {
      expect(template.html).toContain('Verify your email');
      for (const digit of code.split('')) {
        expect(template.html).toContain(`>${digit}<`);
      }
      expect(template.text).toContain(code);
    });
  });

  describe('password reset email', () => {
    const template = renderPasswordResetEmail(resetUrl);

    it('9. uses the professional reset subject and heading', () => {
      expect(template.subject).toBe(EMAIL_SUBJECTS.passwordReset);
      expect(template.subject).toBe('Reset your password — EVO');
      expect(template.html).toContain('Reset your password');
      expect(template.html).toContain('We received a request to reset the password for your EVO account.');
    });

    it('10. includes the existing backend reset link (button + readable link) in HTML and text', () => {
      expect(template.html).toContain('mode=reset&amp;token=');
      expect(template.html).toContain('https://evostream.tv/creator/auth');
      expect(template.html).toContain(resetToken);
      expect(template.text).toContain(resetUrl);
      expect(template.text).toContain('mode=reset&token=');
    });

    it('11. adds the ignore note and expiry safety copy', () => {
      expect(template.html).toContain("If you didn't request a password reset, you can safely ignore this email.");
      expect(template.html).toContain('expires according to the existing backend policy');
      expect(template.text).toContain('you can safely ignore this email.');
      expect(template.text).toContain('expires according to the existing backend policy');
    });

    it('12. exposes the reset token only inside the intended reset link', () => {
      const srcs = template.html.match(/src="[^"]*"/g) ?? [];
      const hrefs = template.html.match(/href="[^"]*"/g) ?? [];
      expect(srcs.join('')).not.toContain(resetToken);
      // The token appears only inside reset-action hrefs (button + fallback link).
      for (const href of hrefs) {
        if (href.includes('mode=reset&amp;token=')) {
          expect(href).toContain(resetToken);
        }
      }
      expect(hrefs.join('')).toContain(resetToken);
    });
  });

  describe('branding / logo handling (EMAIL_LOGO_URL)', () => {
    const publicLogo = 'https://cdn.evo.example/brand/evo-logo.png';

    it('13. renders a text EVO brand header when no logo is configured', () => {
      const template = renderVerificationEmail(code);
      expect(template.html).toContain('EVO');
      expect(template.html).toContain('STREAM BEYOND');
      expect(template.html).not.toContain('<img');
      expect(template.html).not.toContain('src="');
    });

    it('13b. missing EMAIL_LOGO_URL never breaks rendering or sending', () => {
      expect(() => renderVerificationEmail(code)).not.toThrow();
      expect(() => renderResendVerificationEmail(code)).not.toThrow();
      expect(() => renderPasswordResetEmail(resetUrl)).not.toThrow();
    });

    it('14. renders a public HTTPS logo URL as the brand header', () => {
      const template = renderVerificationEmail(code, { logoUrl: publicLogo });
      expect(template.html).toContain(`src="${publicLogo}"`);
      expect(template.html).toContain('alt="EVO"');
    });

    it('14b. logo URL is HTML-escaped before embedding', () => {
      const logoWithParams = 'https://cdn.evo.example/logo.png?q=1&x="quoted"';
      const sanitized = sanitizeLogoUrl(logoWithParams);
      expect(sanitized).not.toBeNull();
      const template = renderVerificationEmail(code, { logoUrl: logoWithParams });
      expect(template.html).toContain('&amp;');
      expect(template.html).toContain('&quot;');
      expect(template.html).not.toContain('x="quoted"');
    });

    it('15. rejects localhost / loopback / file logo URLs and falls back to the text brand', () => {
      const invalidLogos = [
        'http://localhost:8080/logo.png',
        'https://127.0.0.1/logo.png',
        'https://0.0.0.0/logo.png',
        'file:///C:/logo.png',
        '//cdn.evo.example/logo.png',
        'not-a-url',
      ];
      for (const bad of invalidLogos) {
        expect(sanitizeLogoUrl(bad)).toBeNull();
        const template = renderVerificationEmail(code, { logoUrl: bad });
        expect(template.html).not.toContain('<img');
        expect(template.html).not.toContain('localhost');
        expect(template.html).not.toContain('127.0.0.1');
        expect(template.html).not.toContain('file:');
        expect(template.html).toContain('STREAM BEYOND');
      }
    });

    it('16. never contains a localhost or file image URL in any generated output', () => {
      const outputs = [
        renderVerificationEmail(code).html,
        renderResendVerificationEmail(code).html,
        renderPasswordResetEmail(resetUrl).html,
        renderVerificationEmail(code, { logoUrl: publicLogo }).html,
      ];
      for (const html of outputs) {
        const imgSrcs = html.match(/<img[^>]+src="([^"]*)"/g) ?? [];
        for (const img of imgSrcs) {
          expect(img.toLowerCase()).not.toContain('localhost');
          expect(img.toLowerCase()).not.toContain('127.0.0.1');
          expect(img.toLowerCase()).not.toContain('file:');
        }
      }
    });
  });

  describe('shared layout', () => {
    it('17. renderEmailLayout exposes the shared layout with branding, card, and footer', () => {
      const html = renderEmailLayout({
        subject: 'Test — EVO',
        heading: 'Test heading',
        body: '<p>Body</p>',
      });
      expect(html).toContain('EVO');
      expect(html).toContain('STREAM BEYOND');
      expect(html).toContain('Test heading');
      expect(html).toContain('max-width:600px');
      expect(html).toContain('background-color:#FAFAFA');
      expect(html).toContain('#FF2A1B');
      expect(html).toContain('© EVO');
      expect(html).toContain('Stream Beyond');
    });

    it('18. all templates share the same layout shell (single source, no duplication)', () => {
      const verification = renderVerificationEmail(code).html;
      const resend = renderResendVerificationEmail(code).html;
      const reset = renderPasswordResetEmail(resetUrl).html;
      const shell = verification.slice(0, verification.indexOf('<title>'));
      expect(resend.startsWith(shell)).toBe(true);
      expect(reset.startsWith(shell)).toBe(true);
      expect(shell.length).toBeGreaterThan(200);
    });
  });
});