import { z } from 'zod';

const CREATED_EVENTS = ['conversation_created', 'automation_event.conversation_created'];

const payloadSchema = z.object({
  event: z.string(),
  channel: z.string().nullish(),
  meta: z
    .object({
      sender: z
        .object({ name: z.string().nullish(), phone_number: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  contact_inbox: z.object({ source_id: z.string().nullish() }).nullish(),
});

export type ChatwootContact = { phone: string; name: string | null };

/** The person behind a new WhatsApp conversation, or null for any event we do not act on. */
export function newConversationContact(raw: unknown): ChatwootContact | null {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { event, channel, meta, contact_inbox } = parsed.data;
  if (!CREATED_EVENTS.includes(event) || channel !== 'Channel::Whatsapp') return null;

  // WhatsApp's own id is the number with its country code and no +.
  const number = meta?.sender?.phone_number || contact_inbox?.source_id || '';
  const digits = number.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;

  // An unsaved contact is often named after its own number, which is not a name.
  const name = meta?.sender?.name?.trim().slice(0, 120) ?? '';
  return { phone: `+${digits}`, name: /\p{L}/u.test(name) ? name : null };
}
