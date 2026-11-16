import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const OUTBOX_LIMIT = 200;

/** An approved template and the values for its placeholders, in order. */
export type WhatsAppTemplateMessage = {
  /** E.164, with or without the leading +. */
  to: string;
  template: string;
  language: string;
  headerImageUrl?: string;
  body: string[];
};

/** Sends approved templates through the WhatsApp Cloud API, or keeps them in memory (`outbox`). */
@Injectable()
export class WhatsAppService {
  private readonly log = new Logger(WhatsAppService.name);
  private readonly provider: Env['WHATSAPP_PROVIDER'];
  private readonly token: string;
  private readonly phoneNumberId: string;
  /** Messages kept by the `outbox` provider, newest last; tests read them. */
  readonly outbox: WhatsAppTemplateMessage[] = [];

  constructor(config: ConfigService<Env, true>) {
    this.provider = config.get('WHATSAPP_PROVIDER', { infer: true });
    this.token = config.get('WHATSAPP_TOKEN', { infer: true }) ?? '';
    this.phoneNumberId = config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true }) ?? '';
  }

  /** Returns the WhatsApp message id, or null for the outbox. */
  async sendTemplate(message: WhatsAppTemplateMessage): Promise<string | null> {
    if (this.provider === 'outbox') {
      this.outbox.push(message);
      if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
      return null;
    }
    const components: object[] = [];
    if (message.headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: message.headerImageUrl } }],
      });
    }
    if (message.body.length) {
      components.push({
        type: 'body',
        parameters: message.body.map((text) => ({ type: 'text', text })),
      });
    }
    const res = await fetch(`${GRAPH_URL}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to.replace(/^\+/, ''),
        type: 'template',
        template: { name: message.template, language: { code: message.language }, components },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`WhatsApp answered ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    const id = json.messages?.[0]?.id ?? null;
    this.log.log(`WhatsApp template "${message.template}" accepted${id ? ` (${id})` : ''}`);
    return id;
  }
}
