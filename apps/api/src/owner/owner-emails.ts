import type { EmailMessage } from '../email/email.service.js';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function message(
  to: string,
  subject: string,
  paragraphs: string[],
  link?: { url: string; label: string },
): EmailMessage {
  const text = [...paragraphs, ...(link ? [`${link.label}: ${link.url}`] : []), '— Restrovia'].join(
    '\n\n',
  );
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">',
    ...paragraphs.map((p) => `<p>${escape(p)}</p>`),
    link
      ? `<p><a href="${escape(link.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escape(link.label)}</a></p>`
      : '',
    '<p style="color:#666">— Restrovia</p>',
    '</div>',
  ].join('');
  return { to, subject, text, html };
}

const ignore = 'If this wasn’t you, you can ignore this email.';
const notYou = 'If this wasn’t you, reset your password now and contact Restrovia support.';

export const ownerEmails = {
  invite: (to: string, name: string, storeName: string, url: string) =>
    message(
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
};
