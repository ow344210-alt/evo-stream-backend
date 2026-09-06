/**
 * Professional EVO-branded transactional email templates.
 *
 * Pure rendering functions (no I/O, no DI). Every template renders:
 *  - an email-client-safe HTML document (table-based layout, inline styles,
 *    ~600px responsive, light theme with EVO red-orange accents),
 *  - a dedicated plain-text alternative, and
 *  - a professional subject line.
 *
 * Branding mirrors the EVO web theme (frontend tailwind.config.ts tokens):
 * evo-red #FF2A1B, evo-dark.text #0A0D14, evo-cream #FAFAFA, muted #6B7280.
 *
 * NOTE: these are transactional/security emails — no JavaScript, no external
 * CSS, no animations, no marketing-style imagery.
 */

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export interface BrandedEmailOptions {
  /**
   * Optional public HTTP(S) logo URL (from the non-secret `EMAIL_LOGO_URL`
   * configuration variable). Must be an absolute public URL that is not a
   * local/loopback address; otherwise the text-based EVO brand header is used.
   */
  logoUrl?: string | null;
}

/** Professional subject lines used across transactional emails. */
export const EMAIL_SUBJECTS = {
  verification: 'Verify your email — EVO',
  resendVerification: 'Your new verification code — EVO',
  passwordReset: 'Reset your password — EVO',
} as const;

/** EVO brand palette — mirrors the web theme. */
const THEME = {
  red: '#FF2A1B',
  redHover: '#E01C0E',
  ink: '#0A0D14',
  muted: '#6B7280',
  softMuted: '#9CA3AF',
  cream: '#FAFAFA',
  card: '#FFFFFF',
  border: '#E8EAEF',
  gray: '#E5E7EB',
} as const;

const FONT_STACK = 'Arial, Helvetica, sans-serif';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Accepts only absolute public HTTP(S) logo URLs. Rejects local, loopback,
 * protocol-relative, and non-HTTP(S) values so a misconfigured `EMAIL_LOGO_URL`
 * can never point at a local filesystem path or inject markup. Returns the
 * (unescaped) URL on success or `null` to fall back to the text brand header.
 */
export function sanitizeLogoUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const candidate = raw.trim();
  const lower = candidate.toLowerCase();
  if (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes('::1') ||
    lower.includes('file:') ||
    lower.startsWith('//')
  ) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  return candidate;
}

function paragraph(content: string, muted = false): string {
  const styles = muted
    ? `margin:16px 0 0 0; font-size:13px; line-height:20px; color:${THEME.muted};`
    : `margin:0 0 8px 0; font-size:15px; line-height:24px; color:${THEME.ink};`;
  return `<p style="margin:0; padding:0; ${styles} font-family:${FONT_STACK};">${content}</p><br />`;
}

/**
 * Brand header. Uses the configured public logo when available; otherwise the
 * EVO text wordmark with the STREAM BEYOND tagline keeps the email on-brand.
 */
function renderBrandHeader(logoUrl?: string | null): string {
  const safeLogo = sanitizeLogoUrl(logoUrl);
  if (safeLogo) {
    const src = escapeHtml(safeLogo);
    return `
      <img
        src="${src}"
        alt="EVO"
        width="160"
        style="display:inline-block; max-width:160px; height:auto; border:0; outline:none; text-decoration:none;"
      />`;
  }
  return `
    <div style="font-family:${FONT_STACK}; color:${THEME.ink}; font-size:30px; font-weight:800; line-height:32px; letter-spacing:2px;">EVO</div>
    <div style="font-family:${FONT_STACK}; color:${THEME.red}; font-size:11px; font-weight:700; line-height:14px; letter-spacing:4px; margin-top:6px;">STREAM BEYOND</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 0 auto;">
      <tr><td style="width:44px; height:3px; border-radius:3px; background-color:${THEME.red};"></td></tr>
    </table>`;
}

/**
 * The large verification code panel. Each digit is a table cell so the layout
 * degrades gracefully across email clients and the code stays highly visible
 * but professional.
 */
function renderOtpCode(code: string): string {
  const digits = code
    .split('')
    .map(
      (digit) =>
        `<td style="padding:0 8px; font-family:${FONT_STACK}; font-size:34px; line-height:44px; font-weight:700; color:${THEME.ink}; text-align:center;">${digit}</td>`,
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" aria-label="Your EVO verification code" style="margin:0 auto; background-color:${THEME.cream}; border:1px solid ${THEME.border}; border-radius:12px;">
      <tr>
        <td style="padding:20px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
            <tr>${digits}</tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function renderFooter(): string {
  return `
    <p style="margin:0 0 2px 0; font-family:${FONT_STACK}; font-size:12px; line-height:16px; color:${THEME.softMuted};">© EVO</p>
    <p style="margin:0; font-family:${FONT_STACK}; font-size:12px; line-height:16px; color:${THEME.softMuted};">Stream Beyond</p>`;
}

/**
 * Shared responsive layout: light neutral page background, white rounded
 * content card with subtle border, EVO brand header, and muted footer.
 */
export function renderEmailLayout(options: {
  subject: string;
  heading: string;
  body: string;
  logoUrl?: string | null;
}): string {
  const { subject, heading, body, logoUrl } = options;
  const escapedSubject = escapeHtml(subject);
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapedSubject}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .evo-card-pad { padding: 24px 22px 16px 22px !important; }
        .evo-body-pad { padding: 0 22px 28px 22px !important; }
      }
      body { margin: 0 !important; padding: 0 !important; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${THEME.cream}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <center role="article" aria-roledescription="email" lang="en" style="width:100%; background-color:${THEME.cream};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${THEME.cream};">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="600" style="width:600px; max-width:600px; border-collapse:collapse;">
              <tr>
                <td align="center" style="padding:0 0 24px 0;">
                  ${renderBrandHeader(logoUrl)}
                </td>
              </tr>
              <tr>
                <td align="center" style="background-color:${THEME.card}; border:1px solid ${THEME.border}; border-radius:16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td class="evo-card-pad" style="padding:36px 40px 20px 40px;">
                        <h1 style="margin:0; font-family:${FONT_STACK}; font-size:24px; line-height:30px; font-weight:700; color:${THEME.ink};">${heading}</h1>
                      </td>
                    </tr>
                    <tr>
                      <td class="evo-body-pad" style="padding:0 40px 36px 40px; font-family:${FONT_STACK}; font-size:15px; line-height:24px; color:${THEME.ink};">
                        ${body}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:24px 0 0 0;">
                  ${renderFooter()}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </center>
  </body>
</html>`;
}

function verificationBody(code: string, isResend: boolean): string {
  const intro = isResend
    ? paragraph('Welcome back to EVO.') +
      paragraph('<strong>This is your new verification code.</strong>') +
      paragraph('Use it to complete your account setup.')
    : paragraph('Welcome to EVO.') + paragraph('Use the verification code below to complete your account setup.');
  return (
    intro +
    renderOtpCode(code) +
    '<br />' +
    paragraph('This code expires according to the existing verification policy.', true) +
    paragraph('For your security, never share this verification code with anyone.', true) +
    paragraph("If you didn't create an EVO account, you can safely ignore this email.", true) +
    paragraph('— EVO Team')
  );
}

function verificationText(code: string, isResend: boolean): string {
  const greeting = isResend
    ? ['Welcome back to EVO.', '', 'This is your new verification code.', '', 'Use it to complete your account setup.']
    : ['Welcome to EVO.', '', 'Use the verification code below to complete your account setup.'];
  return [
    'EVO — Stream Beyond',
    '',
    'Verify your email',
    '',
    ...greeting,
    '',
    'Your EVO verification code is:',
    '',
    code,
    '',
    'This code expires according to the existing verification policy.',
    '',
    'For your security, never share this verification code with anyone.',
    '',
    "If you didn't create an EVO account, you can safely ignore this email.",
    '',
    '— EVO Team',
    '',
    '© EVO',
    'Stream Beyond',
  ].join('\n');
}

/** Verification / registration OTP email. */
export function renderVerificationEmail(
  code: string,
  options: BrandedEmailOptions = {},
): EmailTemplateResult {
  const subject = EMAIL_SUBJECTS.verification;
  const html = renderEmailLayout({
    subject,
    heading: 'Verify your email',
    body: verificationBody(code, false),
    logoUrl: options.logoUrl,
  });
  return { subject, html, text: verificationText(code, false) };
}

/** Resend verification email — same template, clearly the NEW code. */
export function renderResendVerificationEmail(
  code: string,
  options: BrandedEmailOptions = {},
): EmailTemplateResult {
  const subject = EMAIL_SUBJECTS.resendVerification;
  const html = renderEmailLayout({
    subject,
    heading: 'Verify your email',
    body: verificationBody(code, true),
    logoUrl: options.logoUrl,
  });
  return { subject, html, text: verificationText(code, true) };
}

/**
 * Password reset email.
 *
 * `resetUrl` is the existing backend-generated reset link
 * (`${FRONTEND_URL}/creator/auth?mode=reset&token=...`); its semantics are
 * unchanged. The reset token is only embedded in the reset link, exactly as
 * the existing flow already does.
 */
export function renderPasswordResetEmail(
  resetUrl: string,
  options: BrandedEmailOptions = {},
): EmailTemplateResult {
  const subject = EMAIL_SUBJECTS.passwordReset;
  const safeUrl = escapeHtml(resetUrl);
  const body =
    paragraph('We received a request to reset the password for your EVO account.') +
    paragraph('Use the button below to create a new password.') +
    '<br />' +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
      <tr>
        <td align="center" style="border-radius:10px; background-color:${THEME.red};">
          <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:${FONT_STACK}; font-size:15px; line-height:18px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Reset password</a>
        </td>
      </tr>
    </table>` +
    '<br />' +
    paragraph('Or copy this link into your browser.', true) +
    `<p style="margin:0; padding:0; font-family:${FONT_STACK}; font-size:13px; line-height:20px; color:${THEME.red}; word-break:break-word;">
      <a href="${safeUrl}" style="color:${THEME.red}; text-decoration:underline;">${safeUrl}</a>
    </p>` +
    '<br />' +
    paragraph("If you didn't request a password reset, you can safely ignore this email.", true) +
    paragraph('For security, this reset request expires according to the existing backend policy.', true) +
    paragraph('— EVO Team');
  const text = [
    'EVO — Stream Beyond',
    '',
    'Reset your password',
    '',
    'We received a request to reset the password for your EVO account.',
    '',
    'Use the link below to reset your password:',
    '',
    resetUrl,
    '',
    "If you didn't request a password reset, you can safely ignore this email.",
    '',
    'For security, this reset request expires according to the existing backend policy.',
    '',
    '— EVO Team',
    '',
    '© EVO',
    'Stream Beyond',
  ].join('\n');
  return { subject, html: renderEmailLayout({ subject, heading: 'Reset your password', body, logoUrl: options.logoUrl }), text };
}