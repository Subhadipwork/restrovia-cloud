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
    role_not_allowed: 'Your role does not allow this.',
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
    not_signed_in: 'Your session ended. Sign in again.'
  };
  if (err.status === 429) return 'Too many attempts. Wait 15 minutes and try again.';
  return messages[err.body.error ?? ''] ?? err.body.issues?.join(', ') ?? err.message;
}
