import { BadRequestException } from '@nestjs/common';
import { ADMIN_AUTH } from '@restrovia/shared';
import { COMMON_PASSWORDS } from '../owner/common-passwords.js';
import { message } from '../owner/owner-emails.js';

/** Emails to Restrovia staff about their admin panel account. */
export const adminEmails = {
  invite: (to: string, name: string, invitedBy: string, roleName: string, url: string) =>
    message(
      to,
      'You’re invited to the Restrovia admin panel',
      [
        `Hi ${name},`,
        `${invitedBy} has added you to the Restrovia admin panel as ${roleName}.`,
        'Open the link to choose your password. You’ll then set up two-step sign-in with an authenticator app. The link works once and expires in 7 days.',
      ],
      { url, label: 'Accept the invite' },
    ),
  resetPassword: (to: string, url: string) =>
    message(
      to,
      'Reset your Restrovia admin password',
      [
        'Someone asked to reset the password for this Restrovia admin account.',
        'The link works once and expires in an hour. You’ll still need your authenticator code to sign in.',
        'If this wasn’t you, ignore this email; your password stays the same.',
      ],
      { url, label: 'Choose a new password' },
    ),
  passwordChanged: (to: string) =>
    message(to, 'Your Restrovia admin password was changed', [
      'The password for this Restrovia admin account was just changed, and every session was signed out.',
      'If this wasn’t you, contact a Restrovia super admin straight away.',
    ]),
};

/** Same rules as owner passwords: length, not the email, not a common password. */
export function assertAdminPassword(password: string, email: string) {
  const lower = password.toLowerCase();
  if (password.length < ADMIN_AUTH.passwordMin || password.length > ADMIN_AUTH.passwordMax) {
    throw new BadRequestException({ error: 'weak_password', reason: 'length' });
  }
  if (lower === email.toLowerCase() || lower === email.toLowerCase().split('@')[0]) {
    throw new BadRequestException({ error: 'weak_password', reason: 'email' });
  }
  if (COMMON_PASSWORDS.has(lower)) {
    throw new BadRequestException({ error: 'weak_password', reason: 'common' });
  }
}
