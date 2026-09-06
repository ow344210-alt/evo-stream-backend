import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /**
   * Optional explicit plain-text alternative. When present it is sent as the
   * Brevo `textContent` verbatim; otherwise a plain-text version is derived
   * from `html`.
   */
  text?: string;
}

interface Sender {
  email: string;
  name: string;
}

const BREVO_API_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_SENDER_NAME = 'EVO';
const MAX_SENDER_NAME_LENGTH = 70;

/**
 * EmailService abstraction.
 *
 * Transactional email delivery is handled by Brevo's Web API
 * (`POST /v3/smtp/email`), authenticated with the `BREVO_API_KEY` sent in the
 * `api-key` HTTP header. The sender address comes from the `EMAIL_FROM`
 * configuration variable (used for `sender.email`; an explicit display name
 * embedded in `EMAIL_FROM` is respected, otherwise the sender name is "EVO").
 *
 * Brevo is used only when a `BREVO_API_KEY` is configured. Otherwise the
 * service runs in DEVELOPMENT mode: it logs the recipient and subject that
 * would have been sent but never claims a successful delivery.
 *
 * IMPORTANT: The returned `delivered` flag is `false` in development mode so
 * callers must NOT report to clients that an email was delivered.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    this.apiKey = apiKey && apiKey.trim() ? apiKey.trim() : null;
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  private parseSender(): Sender | null {
    const raw = this.config.get<string>('EMAIL_FROM');
    if (!raw || !raw.trim()) {
      return null;
    }
    const value = raw.trim();
    const angleMatch = /^(.+?)?\s*<([^>]+)>\s*$/.exec(value);
    if (angleMatch) {
      const name = angleMatch[1]
        ? angleMatch[1].replace(/^['"]|['"]$/g, '').trim()
        : '';
      const email = angleMatch[2].trim();
      if (!email) {
        return null;
      }
      return {
        email,
        name: name || DEFAULT_SENDER_NAME,
      };
    }
    if (value.includes('@')) {
      return { email: value, name: DEFAULT_SENDER_NAME };
    }
    return null;
  }

  private toPlainText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  /**
   * Sends an email via Brevo. Returns `{ delivered: boolean, devMode: boolean }`.
   * `delivered` is only `true` when Brevo accepted the send (HTTP 2xx). In
   * development mode `delivered` is `false` and the message is only logged.
   */
  async send(message: EmailMessage): Promise<{ delivered: boolean; devMode: boolean }> {
    if (!this.apiKey) {
      this.logger.log(
        `[DEV-MODE] Would send email to ${message.to} with subject "${message.subject}"`,
      );
      return { delivered: false, devMode: true };
    }

    const sender = this.parseSender();
    if (!sender) {
      this.logger.warn('EMAIL_FROM is not configured; email not sent');
      return { delivered: false, devMode: false };
    }

    try {
      const response = await fetch(BREVO_API_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          sender: {
            email: sender.email,
            name: sender.name.slice(0, MAX_SENDER_NAME_LENGTH),
          },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text ?? this.toPlainText(message.html),
        }),
      });

      if (!response.ok) {
        await this.logProviderError(response);
        return { delivered: false, devMode: false };
      }

      return { delivered: true, devMode: false };
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${message.to} via Brevo`,
        error instanceof Error ? error.stack : undefined,
      );
      return { delivered: false, devMode: false };
    }
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async logProviderError(response: Response): Promise<void> {
    const result = (await this.safeJson(response)) as
      | { message?: unknown; code?: unknown }
      | null;
    if (result && typeof result.message === 'string' && result.message) {
      const code =
        result.code === null || result.code === undefined
          ? String(response.status)
          : String(result.code);
      this.logger.error(
        `Brevo sendTransactionalEmail failed (HTTP ${response.status}, code ${code}): ${result.message.slice(0, 300)}`,
      );
      return;
    }
    this.logger.error(`Brevo sendTransactionalEmail failed (HTTP ${response.status})`);
  }
}