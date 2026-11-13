import { AcceptInviteScreen } from '@/features/auth/email-links';

export const metadata = { title: 'Accept invite' };

export default async function AcceptInvitePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInviteScreen token={token ?? ''} />;
}
