/** Values owned by Restrovia Cloud. Values that come from the POS (order type, order status) are not restricted here. */

export const STORE_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const DEFAULT_STORE_TIMEZONE = 'Asia/Kolkata';

/** Where a POS backup was written, and how it ended; reported by the POS as `backup.*` events. */
export const BACKUP_DESTINATIONS = ['local', 'google_drive', 'other'] as const;
export type BackupDestination = (typeof BACKUP_DESTINATIONS)[number];
export const BACKUP_STATUSES = ['success', 'failed'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const OWNER_STATUSES = ['active', 'disabled'] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

/** Alert emails an owner can turn on or off. */
export const NOTIFICATION_KINDS = ['daily_summary', 'store_offline'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const STORE_MEMBER_ROLES = ['owner', 'manager'] as const;
export type StoreMemberRole = (typeof STORE_MEMBER_ROLES)[number];

/** What a link emailed to an owner does; `change_email` confirms a new address. */
export const OWNER_EMAIL_TOKEN_PURPOSES = ['invite', 'reset_password', 'change_email'] as const;
export type OwnerEmailTokenPurpose = (typeof OWNER_EMAIL_TOKEN_PURPOSES)[number];

/** Owner sign-in and 2FA rules. */
export const OWNER_AUTH = {
  sessionDays: 30,
  passwordMin: 8,
  passwordMax: 128,
  lockoutFailures: 10,
  lockoutMinutes: 15,
  challengeMinutes: 5,
  challengeAttempts: 5,
  setupTokenMinutes: 10,
  recoveryCodeCount: 10,
  inviteDays: 7,
  changeEmailHours: 24,
  resetPasswordMinutes: 30,
} as const;

export const ADMIN_STATUSES = ['active', 'disabled'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  'trial',
  'active',
  'past_due',
  'expired',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A store has at most one subscription in one of these states. */
export const CURRENT_SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due'] as const;

export const TRIAL_DAYS = 30;

export const PAYMENT_METHODS = ['manual', 'razorpay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const COMMAND_STATUSES = ['queued', 'sent', 'done', 'failed', 'expired'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/** Commands the POS knows how to answer (see executeCommand in the POS cloud-sync service). */
export const COMMAND_TYPES = [
  'health.get',
  'orders.live',
  'orders.get',
  'report.sales',
  'report.dashboard',
  'report.hourly',
  'report.items',
  'report.payments',
  'licence.refresh',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_TTL_SECONDS = 60;

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const DELETION_STATUSES = ['pending', 'cancelled', 'completed'] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export const POS_EVENT_TYPES = ['order.created', 'order.updated', 'order.status'] as const;
export type PosEventType = (typeof POS_EVENT_TYPES)[number];

/** Retention windows used by the cleanup jobs. */
export const RETENTION = {
  nonceMinutes: 10,
  ownerEmailTokenDays: 7,
  ownerSessionDays: 30,
  syncEventPayloadDays: 30,
  commandDays: 7,
  diagnosticsDays: 30,
  presenceDays: 90,
  backupDays: 365,
} as const;

/** Features sent back to the POS in the heartbeat response. */
export const DEFAULT_POS_FEATURES = {
  cloud_sync_enabled: true,
  cloud_orders_enabled: true,
  cloud_reports_enabled: true,
} as const;

/**
 * POS licensing. The POS keeps a copy of these values in shared/restrovia-licence.ts
 * (restrovia-pos); change both together.
 */
export const LICENCE = {
  /** The POS must reach the licence server at least this often or billing stops. */
  checkinDays: 5,
  /** How long billing keeps working after a subscription ends or is suspended. */
  graceHours: 24,
  /** Banner warnings start this many days before the subscription ends. */
  warnDays: 7,
} as const;

export const LICENCE_STATUSES = ['trial', 'active', 'inactive'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

/** Claims inside a signed licence token. Times are ISO 8601 UTC. */
export type LicenceClaims = {
  v: 1;
  kid: string;
  pos_id: string;
  store_id: string;
  pos_hash: string;
  machine: string;
  status: LicenceStatus;
  plan: string | null;
  ends_at: string;
  grace_ends_at: string;
  iat: string;
  checkin_by: string;
};

export const LEAD_STAGES = [
  'new',
  'contacted',
  'qualified',
  'demo_scheduled',
  'demo_done',
  'trial',
  'negotiation',
  'won',
  'lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCES = [
  'website',
  'walk_in',
  'cold_call',
  'field_visit',
  'referral',
  'partner',
  'whatsapp',
  'instagram',
  'facebook',
  'google_ads',
  'event',
  'pos_install',
  'import',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_TEMPERATURES = ['hot', 'warm', 'cold'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const LEAD_BUSINESS_TYPES = [
  'cafe',
  'restaurant',
  'qsr',
  'bakery',
  'cloud_kitchen',
  'bar',
  'food_truck',
  'other',
] as const;
export type LeadBusinessType = (typeof LEAD_BUSINESS_TYPES)[number];

export const LEAD_LOST_REASONS = [
  'price',
  'chose_competitor',
  'no_response',
  'not_a_fit',
  'closed_business',
  'timing',
  'missing_feature',
  'duplicate',
  'other',
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

/** Activities an admin logs by hand; the others are written by the system. */
export const LEAD_MANUAL_ACTIVITY_TYPES = [
  'note',
  'call',
  'whatsapp',
  'email',
  'meeting',
  'demo',
] as const;
export type LeadManualActivityType = (typeof LEAD_MANUAL_ACTIVITY_TYPES)[number];
export const LEAD_ACTIVITY_TYPES = [
  ...LEAD_MANUAL_ACTIVITY_TYPES,
  'created',
  'stage_change',
  'assignment',
  'task_done',
  'merged',
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const LEAD_CALL_OUTCOMES = [
  'connected',
  'no_answer',
  'busy',
  'wrong_number',
  'call_back',
] as const;
export type LeadCallOutcome = (typeof LEAD_CALL_OUTCOMES)[number];

export const LEAD_TASK_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'demo', 'other'] as const;
export type LeadTaskType = (typeof LEAD_TASK_TYPES)[number];

/** "98000 00000", "098000…" or "9198000…" become "+9198000…"; other input is returned trimmed. */
export function normaliseIndianPhone(value: string): string {
  const compact = value.replace(/[\s().-]/g, '');
  if (!compact || compact.startsWith('+')) return compact;
  if (/^0?\d{10}$/.test(compact)) return `+91${compact.slice(-10)}`;
  if (/^91\d{10}$/.test(compact)) return `+${compact}`;
  return compact;
}
