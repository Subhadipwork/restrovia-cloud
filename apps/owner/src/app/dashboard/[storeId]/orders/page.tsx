import PageContainer from '@/components/layout/page-container';
import { OrdersScreen } from '@/features/stores/orders';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Orders' };

export default async function OrdersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Orders'
      pageDescription='Every order the POS has synced.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <OrdersScreen storeId={storeId} />
    </PageContainer>
  );
}
