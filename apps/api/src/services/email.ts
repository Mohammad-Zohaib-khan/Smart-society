import nodemailer from 'nodemailer';
import type { Env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly kind: 'none' | 'console' | 'smtp';
  /** Returns true when the message was handed to a delivery mechanism. */
  send(message: EmailMessage): Promise<boolean>;
}

class DisabledEmail implements EmailProvider {
  readonly kind = 'none' as const;
  async send(): Promise<boolean> {
    return false;
  }
}

/** Development only: writes the message to the API log instead of sending it. */
class ConsoleEmail implements EmailProvider {
  readonly kind = 'console' as const;
  constructor(private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<boolean> {
    this.logger.info({ emailTo: message.to, emailSubject: message.subject }, `[DEV EMAIL — not delivered]\n${message.text}`);
    return true;
  }
}

class SmtpEmail implements EmailProvider {
  readonly kind = 'smtp' as const;
  private readonly transport;
  constructor(
    env: Env,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    });
  }
  async send(message: EmailMessage): Promise<boolean> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
    return true;
  }
}

export function createEmailProvider(env: Env, logger: Logger): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmail(env, env.EMAIL_FROM ?? '');
    case 'console':
      return new ConsoleEmail(logger);
    default:
      return new DisabledEmail();
  }
}
