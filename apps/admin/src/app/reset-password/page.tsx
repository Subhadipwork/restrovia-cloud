import { ResetPasswordScreen } from '@/features/auth/email-links';

export const metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordScreen token={token ?? ''} />;
}
