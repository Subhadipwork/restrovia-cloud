import PageContainer from '@/components/layout/page-container';
import { DetailsScreen } from '@/features/stores/details';

export const metadata = { title: 'Café details' };

export default async function DetailsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer
      pageTitle='Café details'
      pageDescription='Store code, contact, region, licence and POS computers.'
    >
      <DetailsScreen storeId={storeId} />
    </PageContainer>
  );
}
