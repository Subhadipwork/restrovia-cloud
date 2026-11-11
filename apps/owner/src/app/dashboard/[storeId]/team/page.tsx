import PageContainer from '@/components/layout/page-container';
import { StoreStatusBadge } from '@/features/stores/store-gate';
import { TeamScreen } from '@/features/stores/team';

export const metadata = { title: 'Team' };

export default async function TeamPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Team'
      pageDescription='Who can see this café, and the managers you’ve invited.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <TeamScreen storeId={storeId} />
    </PageContainer>
  );
}
