import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * EmailService abstraction.
 *
 * Resend is used only when both a `RESEND_API_KEY` is configured AND the
 * `resend` package is available. Otherwise the service runs in DEVELOPMENT
 * mode: it logs the message that would have been sent but never claims a
 * successful delivery.
 *
 * IMPORTANT: The returned `delivered` flag is `false` in development mode so
 * callers must NOT report to clients that an email was delivered.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: { emails: { send: (p: unknown) => Promise<unknown> } } | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    let resend = null;
    if (apiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Resend } = require('resend');
        resend = new Resend(apiKey);
      } catch {
        this.logger.warn('Resend package not available; falling back to dev mode');
      }
    }
    this.resend = resend;
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  /**
   * Sends an email. Returns `{ delivered: boolean, devMode: boolean }`.
   * `delivered` is only `true` when Resend acknowledged the send. In
   * development mode `delivered` is `false` and the message is only logged.
   */
  async send(message: EmailMessage): Promise<{ delivered: boolean; devMode: boolean }> {
    if (!this.resend) {
      this.logger.log(
        `[DEV-MODE] Would send email to ${message.to} with subject "${message.subject}"`,
      );
      return { delivered: false, devMode: true };
    }

    const from = this.config.get<string>('EMAIL_FROM') || 'EVO <no-reply@delivered.local>';
    try {
      await this.resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
      });
      return { delivered: true, devMode: false };
    } catch (error) {
      this.logger.error(`Failed to send email to ${message.to}`, error as Error);
      return { delivered: false, devMode: false };
    }
  }
}
