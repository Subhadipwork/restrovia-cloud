export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; message?: string; issues?: string[] }
  ) {
    super(body.message ?? body.error ?? `Request failed (${status})`);
  }
}

/** Calls the Restrovia Cloud admin API with the session cookie and the panel's CSRF header. */
export async function adminApi<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const res = await fetch(`/api/admin${path}${qs ? `?${qs}` : ''}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Restrovia-Admin': '1',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Words for the API's error codes, shown to admins. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError))
    return 'Something went wrong. Check your connection and try again.';
  const messages: Record<string, string> = {
    invalid_credentials: 'Email or password is wrong.',
    code_required: 'Enter the 6-digit code from your authenticator app.',
    invalid_code: 'That code is wrong or was already used. Wait for the next code and try again.',
    setup_expired: 'Setup took too long. Sign in again to get a new code.',
    invalid_setup_token: 'Setup is no longer valid. Sign in again.',
    permission_denied: 'Your role doesn’t allow this.',
    unknown_role: 'That role no longer exists.',
    role_above_yours: 'You can only give roles that don’t allow more than your own.',
    role_not_found: 'That role no longer exists.',
    role_name_in_use: 'A role with this name already exists. Choose another name.',
    system_role_locked: 'Super admin always has every permission and can’t be changed or deleted.',
    system_role_name_fixed: 'Built-in roles keep their names. You can change their permissions.',
    role_in_use: 'People still have this role. Give them another role first.',
    unknown_permission: 'One of those permissions doesn’t exist. Reload the page and try again.',
    permission_above_yours: 'You can only give permissions you have yourself.',
    role_needs_permissions: 'A built-in role needs at least one permission.',
    cannot_change_own_role: 'You can’t change your own role. Ask another admin.',
    last_super_admin:
      'This is the last Super admin who can sign in. Add another Super admin first, so nobody is locked out.',
    still_invited: 'This person hasn’t accepted their invite yet. Cancel the invite instead.',
    not_invited: 'This person has already accepted their invite.',
    not_active: 'Only active accounts can get a password reset.',
    too_many_emails: 'Three emails went to this person in the last hour. Try again later.',
    use_my_account: 'Change your own account from My account.',
    session_not_found: 'That session has already ended.',
    invalid_link: 'This link doesn’t work any more. It may have been used, replaced or expired.',
    wrong_password: 'That isn’t your current password.',
    same_password: 'Choose a password different from your current one.',
    admin_above_yours:
      'This person’s role allows more than yours, so you can’t change their account.',
    store_has_paid_licence: 'This store has a paid licence, so its trial can’t be extended.',
    no_current_licence: 'This store has no current licence to suspend.',
    unknown_plan: 'That plan doesn’t exist.',
    email_in_use: 'An admin with this email already exists.',
    plan_code_in_use: 'A plan with this code already exists. Choose another code.',
    plan_not_found: 'That plan no longer exists.',
    cannot_change_own_status: 'You can’t disable your own account.',
    owner_not_found: 'That owner account no longer exists.',
    store_not_found: 'That store no longer exists.',
    already_linked: 'This email already has access to this store.',
    already_set_up:
      'This owner has already chosen a password. They can use “Forgot password” instead.',
    owner_disabled: 'This owner account is disabled. Enable it first.',
    member_not_found: 'That person is no longer linked to this store.',
    phone_taken: 'Another owner account already uses this phone number.',
    weak_password: 'That password is too short, too common, or the same as the email.',
    two_factor_off: 'Two-factor authentication is already off for this owner.',
    not_signed_in: 'Your session ended. Sign in again.',
    lead_not_found: 'That lead no longer exists.',
    task_not_found: 'That follow-up no longer exists.',
    lost_reason_required: 'Choose why the lead was lost.',
    won_needs_store: 'Link the customer’s store before marking the lead won.',
    store_has_lead: 'That store is already linked to another lead.',
    invalid_assignee: 'Leads can only be given to active sales or super admins.',
    activity_in_future: 'An activity can’t be dated in the future.',
    cannot_merge_itself: 'A lead can’t be merged into itself.',
    both_have_stores:
      'Both leads are linked to different customer stores. Unlink one store before merging.',
    import_empty: 'That file is empty.',
    import_needs_business_name: 'The file needs a business_name column. Download the template.',
    import_too_many_rows: 'That file has more than 2,000 rows. Split it into smaller files.'
  };
  if (err.status === 429) return 'Too many attempts. Wait 15 minutes and try again.';
  return messages[err.body.error ?? ''] ?? err.body.issues?.join(', ') ?? err.message;
}
