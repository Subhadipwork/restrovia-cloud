export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; reason?: string; message?: string; issues?: string[] }
  ) {
    super(body.message ?? body.error ?? `Request failed (${status})`);
  }
}

/** Calls the Restrovia Cloud owner API with the session cookie and the portal's CSRF header. */
export async function ownerApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`/api/owner${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Restrovia-Owner': '1',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

const WEAK_PASSWORD: Record<string, string> = {
  length: 'Use at least 8 characters.',
  email: 'Don’t use your email address as the password.',
  common: 'That password is too common. Try a short sentence that only you would know.'
};

/** Words for the API's error codes, shown to café owners. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError))
    return 'Something went wrong. Check your internet connection and try again.';
  const code = err.body.error ?? '';
  if (code === 'owner_approval_needed')
    return `A café owner has to publish these price changes (more than 25%): ${err.body.message ?? ''}`;
  if (code === 'invalid_fields' && err.body.message) return err.body.message;
  if (code === 'pos_refused')
    return err.body.message
      ? `The POS did not accept it: ${err.body.message}`
      : 'The POS did not accept the change.';
  if (code === 'invite_limit')
    return 'Too many invites for this café today. Try again tomorrow, or ask Restrovia support.';
  if (code === 'resend_too_soon')
    return 'An invite was just sent. Wait a minute before sending again.';
  if (code === 'too_many_codes')
    return 'Too many wrong codes. Wait 15 minutes, then make a new code on the POS.';
  if (err.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'weak_password') return WEAK_PASSWORD[err.body.reason ?? ''] ?? WEAK_PASSWORD.common;
  const messages: Record<string, string> = {
    invalid_credentials:
      'Email or password is wrong. After 10 wrong tries, sign-in is paused for 15 minutes.',
    invalid_code: 'That code is wrong or was already used. Wait for the next code and try again.',
    challenge_expired: 'That took too long or had too many wrong codes. Sign in again.',
    code_required: 'Enter a code from your authenticator app, or a recovery code.',
    wrong_password: 'Your password is wrong.',
    same_password: 'Choose a password different from the one Restrovia gave you.',
    password_change_required: 'Choose your own password first.',
    invalid_token: 'This link has expired or was already used. Ask for a new one.',
    email_taken: 'Another account already uses this email.',
    same_email: 'That is already your email.',
    phone_taken: 'Another account already uses this phone number.',
    setup_expired: 'Setup took too long. Start again.',
    invalid_setup_token: 'Setup is no longer valid. Start again.',
    two_factor_already_on: 'Two-factor authentication is already on.',
    two_factor_off: 'Two-factor authentication is off.',
    session_not_found: 'That device is already signed out.',
    not_signed_in: 'Your session ended. Sign in again.',
    nothing_to_send: 'There is no day with sales to show yet. Try again after the first paid bill.',
    owner_only: 'Only the café’s owners can do this.',
    already_member: 'That person already has access to this café.',
    invite_pending: 'That email already has an invite waiting. Send it again instead.',
    invite_not_found: 'That invite was already accepted or cancelled.',
    member_not_found: 'That person no longer has access to this café.',
    cannot_remove_owner: 'Owners can’t be removed here. Contact Restrovia support.',
    invite_invalid:
      'This invite has expired, was cancelled or was already used. Ask the café’s owner for a new one.',
    account_exists: 'This email already has a Restrovia account. Sign in to accept the invite.',
    invalid_pairing_code:
      'That code is wrong, has expired or was already used. Make a new one on the POS and try again.',
    already_linked: 'This café is already linked to your account.',
    menu_not_synced:
      'The POS has not sent its menu yet. It sends it a few minutes after it goes online.',
    menu_sync_off: 'Menu sync is off on the POS, so changes from here are paused.',
    portal_editing_off:
      'The café turned off menu changes from the portal. Turn it on in the POS settings.',
    pos_offline: 'The POS is offline. Try again when it is back online.',
    pos_no_answer: 'The POS did not answer in time. Try again in a moment.',
    item_not_found: 'That item is no longer on the menu.',
    nothing_to_change: 'Nothing is different from what the POS already has.',
    nothing_to_publish: 'There are no changes to publish.',
    too_many_changes: 'Publish in smaller batches (up to 100 changes at a time).',
    draft_not_found: 'That change was already published or removed.',
    invalid_fields: 'Check the values you entered.',
    menu_not_found: 'That menu no longer exists.',
    menu_name_taken: 'You already have a menu with that name.',
    built_in_menu: 'The built-in menus can’t be deleted. Reset it to the Base Menu instead.',
    too_many_menus: 'You can have up to 20 menus.',
    cannot_revert: 'A removal cannot be undone from here. Add the item again instead.',
    change_not_found: 'That change cannot be undone any more.'
  };
  return messages[code] ?? err.body.issues?.join(', ') ?? err.message;
}
