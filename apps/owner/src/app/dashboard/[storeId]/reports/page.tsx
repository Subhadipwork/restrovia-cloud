import PageContainer from '@/components/layout/page-container';
import { ReportsScreen } from '@/features/stores/reports';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Reports'
      pageDescription='Sales, items, busy hours and payments over any period.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <ReportsScreen storeId={storeId} />
    </PageContainer>
  );
}
