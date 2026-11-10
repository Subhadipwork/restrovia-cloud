import PageContainer from '@/components/layout/page-container';
import { StoreStatusBadge } from '@/features/stores/store-gate';
import { TodayScreen } from '@/features/stores/today';

export const metadata = { title: 'Today' };

export default async function TodayPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Today'
      pageDescription='Sales and orders by business day.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <TodayScreen storeId={storeId} />
    </PageContainer>
  );
}
