import PageContainer from '@/components/layout/page-container';
import { MenuScreen } from '@/features/stores/menu';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Menu' };

export default async function MenuPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Menu'
      pageDescription='The menu on your POS. Mark an item sold out or available again.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <MenuScreen storeId={storeId} />
    </PageContainer>
  );
}
