import type { EmailMessage } from '../email/email.service.js';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type EmailLink = { url: string; label: string };

/** A paragraph may hold several lines; `footer` is a quiet second link, such as "turn these off". */
export function message(
  to: string,
  subject: string,
  paragraphs: string[],
  link?: EmailLink,
  footer?: EmailLink,
): EmailMessage {
  const text = [
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
    '— Restrovia',
    ...(footer ? [`${footer.label}: ${footer.url}`] : []),
  ].join('\n\n');
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">',
    ...paragraphs.map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`),
    link
      ? `<p><a href="${escape(link.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escape(link.label)}</a></p>`
      : '',
    '<p style="color:#666">— Restrovia</p>',
    footer
      ? `<p style="font-size:13px"><a href="${escape(footer.url)}" style="color:#666">${escape(footer.label)}</a></p>`
      : '',
    '</div>',
  ].join('');
  return { to, subject, text, html };
}

const ignore = 'If this wasn’t you, you can ignore this email.';
const notYou = 'If this wasn’t you, reset your password now and contact Restrovia support.';

/** Resend template alias for the owner invite; the built-in text below is the fallback. */
export const OWNER_INVITE_TEMPLATE = 'owner-invite';

export const ownerEmails = {
  invite: (to: string, name: string, storeName: string, url: string): EmailMessage => ({
    ...message(
      to,
      'Your Restrovia account is ready',
      [
        `Hello${name ? ` ${name}` : ''},`,
        `Restrovia set up an account for you to see ${storeName}’s sales and orders from your phone or computer.`,
        'Open the link below and choose a password. It works for 7 days and only once.',
        'If you weren’t expecting this, you can ignore this email.',
      ],
      { url, label: 'Choose your password' },
    ),
    template: {
      id: OWNER_INVITE_TEMPLATE,
      variables: { OWNER_NAME: name || 'there', STORE_NAME: storeName, INVITE_URL: url },
    },
  }),
  storeAdded: (to: string, storeName: string, signInUrl: string) =>
    message(
      to,
      `${storeName} was added to your Restrovia account`,
      [
        `Restrovia added ${storeName} to your account. You’ll see it the next time you sign in.`,
        'If you didn’t ask for this, contact Restrovia support.',
      ],
      { url: signInUrl, label: 'Sign in' },
    ),
  managerInvite: (to: string, inviter: string, storeName: string, url: string) =>
    message(
      to,
      `${inviter} invited you to ${storeName} on Restrovia`,
      [
        `${inviter} invited you to see ${storeName}’s sales and orders on Restrovia as a manager.`,
        'Open the link below to accept. It works for 7 days and only once.',
        'If you weren’t expecting this, you can ignore this email.',
      ],
      { url, label: 'Accept the invite' },
    ),
  managerRemoved: (to: string, storeName: string) =>
    message(to, `You no longer have access to ${storeName}`, [
      `An owner of ${storeName} removed you from the café on Restrovia, so you no longer see its sales and orders.`,
      'If you think this is a mistake, ask the café’s owner.',
    ]),
  resetPassword: (to: string, url: string) =>
    message(
      to,
      'Reset your Restrovia password',
      [
        'Open the link below to choose a new password. It works for 30 minutes and only once.',
        'Two-factor authentication stays on after a reset. ' + ignore,
      ],
      { url, label: 'Choose a new password' },
    ),
  passwordChanged: (to: string) =>
    message(to, 'Your Restrovia password was changed', [
      'The password for your Restrovia account was just changed, and other devices were signed out.',
      notYou,
    ]),
  changeEmailConfirm: (to: string, url: string) =>
    message(
      to,
      'Confirm your new email for Restrovia',
      ['Open the link below to use this address for your Restrovia account.', ignore],
      { url, label: 'Confirm new email' },
    ),
  changeEmailNotice: (to: string, newEmail: string) =>
    message(to, 'Your Restrovia email is being changed', [
      `Someone asked to change the email of your Restrovia account to ${newEmail}. ` +
        'It changes only when the link sent to that address is opened.',
      notYou,
    ]),
  twoFactorOn: (to: string) =>
    message(to, 'Two-factor authentication is on', [
      'Signing in to Restrovia now needs a code from your authenticator app. Keep your recovery codes somewhere safe.',
      notYou,
    ]),
  twoFactorOff: (to: string) =>
    message(to, 'Two-factor authentication is off', [
      'Signing in to Restrovia no longer needs a code from your authenticator app.',
      notYou,
    ]),
  accountReady: (to: string, name: string, storeName: string, signInUrl: string) =>
    message(
      to,
      'Your Restrovia account is ready',
      [
        `Hello${name ? ` ${name}` : ''},`,
        `Restrovia set up an account for you to see ${storeName}’s sales and orders from your phone or computer.`,
        'Sign in with this email and the password Restrovia gave you. You’ll be asked to choose your own password straight away.',
        'If you weren’t expecting this, contact Restrovia support.',
      ],
      { url: signInUrl, label: 'Sign in' },
    ),
  passwordSetBySupport: (to: string, signInUrl: string) =>
    message(
      to,
      'Restrovia support set a new password for you',
      [
        'Restrovia support set a new password on your account and signed out every device. Sign in with the password they gave you; you’ll be asked to choose your own straight away.',
        'If you didn’t ask support for this, contact Restrovia support straight away.',
      ],
      { url: signInUrl, label: 'Sign in' },
    ),
  twoFactorReset: (to: string) =>
    message(to, 'Two-factor authentication was reset by Restrovia support', [
      'Restrovia support turned off two-factor authentication on your account and signed out every device. Sign in and turn it on again from Account → Security.',
      'If you didn’t ask support for this, contact Restrovia support straight away.',
    ]),
  recoveryCodeUsed: (to: string, left: number) =>
    message(to, 'A recovery code was used to sign in', [
      `A recovery code was used to sign in to your Restrovia account. You have ${left} left.`,
      left < 3
        ? 'Make new codes from Account → Security soon.'
        : 'You can make new codes from Account → Security.',
      notYou,
    ]),
  locked: (to: string, minutes: number) =>
    message(to, 'Your Restrovia account is locked for a while', [
      `There were too many wrong sign-in attempts, so sign-in is paused for ${minutes} minutes.`,
      notYou,
    ]),
  storeBlocked: (to: string, storeName: string, reason: string) =>
    message(to, `${storeName}: Restrovia Cloud access is blocked`, [
      `Restrovia has blocked cloud access for ${storeName}.`,
      `Reason: ${reason}`,
      'Billing on the POS keeps working, but orders and reports stop reaching Restrovia Cloud and the owner portal is closed for this store until the block is lifted.',
      'Contact Restrovia support to sort this out.',
    ]),
  storeUnblocked: (to: string, storeName: string) =>
    message(to, `${storeName}: Restrovia Cloud access is restored`, [
      `Restrovia has lifted the block on ${storeName}. Orders and reports go to Restrovia Cloud again and the owner portal is open for this store.`,
    ]),
};
