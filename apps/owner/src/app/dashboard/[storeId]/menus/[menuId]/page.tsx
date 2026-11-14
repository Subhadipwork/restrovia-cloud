import PageContainer from '@/components/layout/page-container';
import { ChannelMenuScreen } from '@/features/stores/menus';
import { StoreStatusBadge } from '@/features/stores/store-gate';

export const metadata = { title: 'Menu prices' };

export default async function ChannelMenuPage({
  params
}: {
  params: Promise<{ storeId: string; menuId: string }>;
}) {
  const { storeId, menuId } = await params;
  return (
    <PageContainer
      pageTitle='Menu prices'
      pageDescription='Set a different price or hide an item on this menu. Anything you leave alone follows the Base Menu.'
      pageHeaderAction={<StoreStatusBadge storeId={storeId} />}
    >
      <ChannelMenuScreen storeId={storeId} menuId={menuId} />
    </PageContainer>
  );
}
