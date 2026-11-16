import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/database.module.js';
import { leadActivities, leads } from '../db/schema/leads.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';

/** The first promotional WhatsApp message to a new lead, sent only when they agreed to it. */
@Injectable()
export class LeadOfferService {
  private readonly log = new Logger(LeadOfferService.name);
  private readonly template: string;
  private readonly imageUrl?: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly whatsapp: WhatsAppService,
    config: ConfigService<Env, true>,
  ) {
    this.template = config.get('WHATSAPP_LEAD_OFFER_TEMPLATE', { infer: true });
    this.imageUrl = config.get('WHATSAPP_LEAD_OFFER_IMAGE_URL', { infer: true });
  }

  /** Sends in the background so adding a lead never waits on, or fails because of, WhatsApp. */
  queue(leadId: string): void {
    this.send(leadId).catch((err: unknown) => {
      this.log.error(`Lead offer for ${leadId} failed: ${(err as Error).message}`);
    });
  }

  /** Returns whether a message went out. */
  async send(leadId: string): Promise<boolean> {
    if (!this.imageUrl) return false;
    const [lead] = await this.db
      .select({
        phone: leads.phoneE164,
        contactName: leads.contactName,
        businessName: leads.businessName,
        consentAt: leads.consentAt,
      })
      .from(leads)
      .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)));
    if (!lead?.phone || !lead.consentAt) return false;

    const now = new Date();
    try {
      const messageId = await this.whatsapp.sendTemplate({
        to: lead.phone,
        template: this.template,
        language: 'en',
        headerImageUrl: this.imageUrl,
        body: [lead.contactName?.trim() || 'there', lead.businessName],
      });
      await this.db.insert(leadActivities).values({
        leadId,
        adminId: null,
        type: 'whatsapp',
        body: 'Sent the welcome offer on WhatsApp.',
        meta: { template: this.template, ...(messageId ? { message_id: messageId } : {}) },
        occurredAt: now,
      });
      return true;
    } catch (err) {
      await this.db.insert(leadActivities).values({
        leadId,
        adminId: null,
        type: 'note',
        body: 'The WhatsApp welcome offer could not be sent.',
        meta: { template: this.template, error: (err as Error).message.slice(0, 300) },
        occurredAt: now,
      });
      throw err;
    }
  }
}
