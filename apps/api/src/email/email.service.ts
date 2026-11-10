import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const OUTBOX_LIMIT = 200;

/** Sends through the provider's HTTPS API with fetch, or keeps messages in memory (`outbox`). */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly provider: Env['EMAIL_PROVIDER'];
  private readonly apiKey: string;
  private readonly from: string;
  /** Prints outbox messages, links included, so local sign-up can be finished by hand. */
  private readonly printOutbox: boolean;
  /** Messages kept by the `outbox` provider, newest last; tests read them. */
  readonly outbox: EmailMessage[] = [];

  constructor(config: ConfigService<Env, true>) {
    this.provider = config.get('EMAIL_PROVIDER', { infer: true });
    this.apiKey = config.get('EMAIL_API_KEY', { infer: true }) ?? '';
    this.from = config.get('EMAIL_FROM', { infer: true });
    const env = config.get('NODE_ENV', { infer: true });
    this.printOutbox = this.provider === 'outbox' && env === 'development';
    if (this.provider === 'outbox' && env === 'production') {
      this.log.warn('EMAIL_PROVIDER is outbox: owner emails are not being sent');
    }
  }

  /**
   * Sends without making the caller wait, so a request that sends mail takes as long as one that
   * doesn't (sign-up and password reset must not reveal which emails have accounts).
   */
  queue(message: EmailMessage): void {
    this.send(message).catch((err: unknown) => {
      this.log.error(`Email "${message.subject}" failed: ${(err as Error).message}`);
    });
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.provider === 'outbox') {
      this.outbox.push(message);
      if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
      if (this.printOutbox) {
        this.log.log(`Email to ${message.to}: ${message.subject}\n${message.text}`);
      }
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`provider answered ${res.status}`);
  }
}
