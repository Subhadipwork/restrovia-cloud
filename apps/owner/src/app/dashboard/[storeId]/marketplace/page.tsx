import PageContainer from '@/components/layout/page-container';
import { MarketplaceScreen } from '@/features/stores/marketplace';

export const metadata = { title: 'Marketplace' };

export default async function MarketplacePage({
  params
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Marketplace'
      pageDescription='Add-ons for your café: add free ones, try paid ones, or ask Restrovia to add them.'
    >
      <MarketplaceScreen storeId={storeId} />
    </PageContainer>
  );
}
