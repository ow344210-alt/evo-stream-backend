import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const buildConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

const mockFetchResponse = (overrides: {
  ok?: boolean;
  status?: number;
  body?: unknown;
} = {}) => {
  const { ok = true, status = 201, body = { messageId: '<msg-1@relay.com>' } } = overrides;
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
};

describe('EmailService (Brevo provider)', () => {
  let fetchMock: jest.Mock;
  const key = 'brevo-test-api-key-secret';

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const loggedMessages = (logger: Logger): string => {
    const callsOf = (fn: unknown): unknown[][] => {
      const mock = (fn as unknown as { mock?: { calls?: unknown[][] } }).mock;
      return mock?.calls ?? [];
    };
    const errorCalls = callsOf(logger.error);
    const warnCalls = callsOf(logger.warn);
    const logCalls = callsOf(logger.log);
    return [...logCalls, ...warnCalls, ...errorCalls]
      .map((call) => String(call[0] ?? ''))
      .join('\n');
  };

  const spyLogger = (service: EmailService): Logger => {
    const logger = (service as unknown as { logger: Logger }).logger;
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    return logger;
  };

  const verificationContent = 'Your EVO verification code is: <strong>482913</strong>';

  describe('delivery via Brevo /v3/smtp/email', () => {
    it('1. authenticates with BREVO_API_KEY via the api-key header', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      const result = await service.send({
        to: 'user@example.com',
        subject: 'S',
        html: '<p>b</p>',
      });

      expect(result).toEqual({ delivered: true, devMode: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(BREVO_ENDPOINT);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Accept']).toBe('application/json');
      expect(init.headers['api-key']).toBe(key);
    });

    it('2. uses EMAIL_FROM for sender.email', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        sender: { email: string; name: string };
      };
      expect(payload.sender.email).toBe('no-reply@evotest.com');
    });

    it('3. uses "EVO" as the sender name for a bare EMAIL_FROM address', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        sender: { email: string; name: string };
      };
      expect(payload.sender.name).toBe('EVO');
    });

    it('3b. respects a display name embedded in EMAIL_FROM (Name <address>)', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'EVO Platform <no-reply@evotest.com>' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        sender: { email: string; name: string };
      };
      expect(payload.sender.email).toBe('no-reply@evotest.com');
      expect(payload.sender.name).toBe('EVO Platform');
    });

    it('4. passes the verification recipient email correctly', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({
        to: 'recipient@example.com',
        subject: 'Verify your EVO email address',
        html: `<p>${verificationContent}</p>`,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        to: { email: string }[];
      };
      expect(payload.to).toEqual([{ email: 'recipient@example.com' }]);
    });

    it('5. the 6-digit verification code is present in htmlContent and textContent', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({
        to: 'user@example.com',
        subject: 'Verify your EVO email address',
        html: `<p>${verificationContent}</p>`,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        subject: string;
        htmlContent: string;
        textContent: string;
      };
      expect(payload.subject).toBe('Verify your EVO email address');
      expect(payload.htmlContent).toContain('482913');
      expect(payload.textContent).toContain('482913');
    });

    it('5b. uses an explicit plain-text alternative as textContent when provided', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());
      const explicitText = 'EVO — Stream Beyond\n\nYour EVO verification code is:\n\n482913';

      await service.send({
        to: 'user@example.com',
        subject: 'Verify your email — EVO',
        html: `<div style="display:none">${explicitText}</div>`,
        text: explicitText,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        htmlContent: string;
        textContent: string;
      };
      expect(payload.textContent).toBe(explicitText);
    });

    it('5c. falls back to a derived plain-text conversion when text is omitted', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(mockFetchResponse());

      await service.send({
        to: 'user@example.com',
        subject: 'S',
        html: `<p>Derived text <strong>482913</strong></p>`,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as { textContent: string };
      expect(payload.textContent).toContain('Derived text');
      expect(payload.textContent).toContain('482913');
    });

    it('8. handles a successful Brevo response (201 + messageId) correctly', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          ok: true,
          status: 201,
          body: { messageId: '<201798300811.5787683@relay.domain.com>' },
        }),
      );

      const result = await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      expect(result).toEqual({ delivered: true, devMode: false });
    });
  });

  describe('failure handling', () => {
    it('9. handles a Brevo API failure without crashing and without leaking the key', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 401,
          body: { code: 'unauthorized', message: 'Invalid API key' },
        }),
      );
      const logger = spyLogger(service);

      const result = await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      expect(result).toEqual({ delivered: false, devMode: false });
      const logs = loggedMessages(logger);
      expect(logs).toContain('HTTP 401');
      expect(logs).not.toContain(key);
      expect(logs).not.toContain('api-key');
    });

    it('10. handles a network failure without crashing and without leaking the key', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const logger = spyLogger(service);

      const result = await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      expect(result).toEqual({ delivered: false, devMode: false });
      const logs = loggedMessages(logger);
      expect(logs).not.toContain(key);
      expect(logs).not.toContain('api-key');
    });

    it('11. runs in dev mode when BREVO_API_KEY is missing (no fetch, nothing delivered)', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: undefined, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      spyLogger(service);

      const result = await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      expect(result).toEqual({ delivered: false, devMode: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(service.isConfigured).toBe(false);
    });

    it('12. fails safely when EMAIL_FROM is missing even with an API key', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: undefined }),
      );
      spyLogger(service);

      const result = await service.send({ to: 'user@example.com', subject: 'S', html: '<p>b</p>' });

      expect(result).toEqual({ delivered: false, devMode: false });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(service.isConfigured).toBe(true);
    });

    it('14/15. never logs the OTP code, reset token, or API key in any provider path', async () => {
      const service = new EmailService(
        buildConfig({ BREVO_API_KEY: key, EMAIL_FROM: 'no-reply@evotest.com' }),
      );
      fetchMock.mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 500,
          body: { code: 'internal_error', message: 'Internal Server Error' },
        }),
      );
      const logger = spyLogger(service);
      const oneTimeCode = '482913';
      const resetToken = 'super-secret-reset-token-abc123';

      await service.send({
        to: 'user@example.com',
        subject: 'Reset your EVO password',
        html: `<p>Code <strong>${oneTimeCode}</strong> reset at https://evotest.app/auth?mode=reset&token=${resetToken}</p>`,
      });

      const logs = loggedMessages(logger);
      expect(logs).not.toContain(key);
      expect(logs).not.toContain(oneTimeCode);
      expect(logs).not.toContain(resetToken);
    });
  });

  describe('production source integrity', () => {
    it('13. no UniOne endpoint/reference remains in the production email source', () => {
      const source = readFileSync(join(__dirname, 'email.service.ts'), 'utf8');
      expect(source.toLowerCase()).not.toContain('unione');
      expect(source).toContain('https://api.brevo.com/v3/smtp/email');
      expect(source).toContain('BREVO_API_KEY');
    });
  });
});