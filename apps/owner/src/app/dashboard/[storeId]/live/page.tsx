import PageContainer from '@/components/layout/page-container';
import { LiveScreen } from '@/features/stores/live';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Live orders' };

export default async function LivePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Live orders'
      pageDescription='Orders open in the café right now.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <LiveScreen storeId={storeId} />
    </PageContainer>
  );
}
