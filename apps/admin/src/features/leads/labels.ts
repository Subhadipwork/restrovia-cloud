import type {
  LeadBusinessType,
  LeadCallOutcome,
  LeadLostReason,
  LeadSource,
  LeadStage,
  LeadTaskType,
  LeadTemperature
} from '@restrovia/shared';

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  demo_scheduled: 'Demo booked',
  demo_done: 'Demo done',
  trial: 'On trial',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost'
};

/**
 * One colour per stage, cool to warm as a lead moves towards a sale. `soft` is for badges and
 * stages already passed, `solid` marks the current stage, `line` edges timeline entries.
 */
export const STAGE_COLOURS: Record<
  LeadStage,
  { soft: string; solid: string; dot: string; line: string }
> = {
  new: {
    soft: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
    solid: 'border-slate-500 bg-slate-500 text-white',
    dot: 'bg-slate-500',
    line: 'border-slate-500'
  },
  contacted: {
    soft: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    solid: 'border-sky-500 bg-sky-500 text-white',
    dot: 'bg-sky-500',
    line: 'border-sky-500'
  },
  qualified: {
    soft: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    solid: 'border-indigo-500 bg-indigo-500 text-white',
    dot: 'bg-indigo-500',
    line: 'border-indigo-500'
  },
  demo_scheduled: {
    soft: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    solid: 'border-violet-500 bg-violet-500 text-white',
    dot: 'bg-violet-500',
    line: 'border-violet-500'
  },
  demo_done: {
    soft: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
    solid: 'border-fuchsia-500 bg-fuchsia-500 text-white',
    dot: 'bg-fuchsia-500',
    line: 'border-fuchsia-500'
  },
  trial: {
    soft: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    solid: 'border-amber-500 bg-amber-500 text-black',
    dot: 'bg-amber-500',
    line: 'border-amber-500'
  },
  negotiation: {
    soft: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    solid: 'border-orange-500 bg-orange-500 text-white',
    dot: 'bg-orange-500',
    line: 'border-orange-500'
  },
  won: {
    soft: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    solid: 'border-emerald-600 bg-emerald-600 text-white',
    dot: 'bg-emerald-500',
    line: 'border-emerald-500'
  },
  lost: {
    soft: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    solid: 'border-red-600 bg-red-600 text-white',
    dot: 'bg-red-500',
    line: 'border-red-500'
  }
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website',
  walk_in: 'Walk-in',
  cold_call: 'Cold call',
  field_visit: 'Field visit',
  referral: 'Referral',
  partner: 'Partner',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  google_ads: 'Google Ads',
  event: 'Event',
  pos_install: 'POS install',
  import: 'Import',
  other: 'Other'
};

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold'
};

export const TEMPERATURE_DOT: Record<LeadTemperature, string> = {
  hot: 'bg-red-500',
  warm: 'bg-amber-500',
  cold: 'bg-sky-500'
};

export const BUSINESS_TYPE_LABELS: Record<LeadBusinessType, string> = {
  cafe: 'Café',
  restaurant: 'Restaurant',
  qsr: 'Quick service',
  bakery: 'Bakery',
  cloud_kitchen: 'Cloud kitchen',
  bar: 'Bar / pub',
  food_truck: 'Food truck',
  other: 'Other'
};

export const LOST_REASON_LABELS: Record<LeadLostReason, string> = {
  price: 'Price too high',
  chose_competitor: 'Chose a competitor',
  no_response: 'Stopped responding',
  not_a_fit: 'Not a fit',
  closed_business: 'Business closed',
  timing: 'Not the right time',
  missing_feature: 'Missing a feature',
  duplicate: 'Duplicate lead',
  other: 'Other'
};

export const OUTCOME_LABELS: Record<LeadCallOutcome, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  wrong_number: 'Wrong number',
  call_back: 'Asked to call back'
};

export const TASK_TYPE_LABELS: Record<LeadTaskType, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  demo: 'Demo',
  other: 'Other'
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  demo: 'Demo',
  created: 'Lead added',
  stage_change: 'Stage changed',
  assignment: 'Owner changed',
  task_done: 'Follow-up done',
  merged: 'Duplicate merged'
};

/** Digits only, for wa.me links. */
export const waNumber = (phone: string) => phone.replace(/\D/g, '');

/** "9800000000" becomes "+919800000000"; anything already international is kept. */
export function normalisePhone(value: string): string {
  const trimmed = value.replace(/[\s()-]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  if (/^0?\d{10}$/.test(trimmed)) return `+91${trimmed.slice(-10)}`;
  if (/^91\d{10}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}
