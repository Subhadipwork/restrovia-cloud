import PageContainer from '@/components/layout/page-container';
import { FollowUpsScreen } from '@/features/leads/follow-ups';

export const metadata = { title: 'My follow-ups' };

export default function FollowUpsPage() {
  return (
    <PageContainer
      pageTitle='My follow-ups'
      pageDescription='Calls, demos and messages you have planned, soonest first.'
    >
      <FollowUpsScreen />
    </PageContainer>
  );
}
