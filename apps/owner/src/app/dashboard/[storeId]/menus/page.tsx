import PageContainer from '@/components/layout/page-container';
import { MenusScreen } from '@/features/stores/menus';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Menus' };

export default async function MenusPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Menus'
      pageDescription='A menu for each way you sell. Each one starts as your Base Menu, the POS menu.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <MenusScreen storeId={storeId} />
    </PageContainer>
  );
}
