import PageContainer from '@/components/layout/page-container';
import { OrderScreen } from '@/features/stores/order';

export const metadata = { title: 'Order' };

export default async function OrderPage({
  params
}: {
  params: Promise<{ storeId: string; orderId: string }>;
}) {
  const { storeId, orderId } = await params;
  return (
    <PageContainer>
      <OrderScreen storeId={storeId} orderId={orderId} />
    </PageContainer>
  );
}
