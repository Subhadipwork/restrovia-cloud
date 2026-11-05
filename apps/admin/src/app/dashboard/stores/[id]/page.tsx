import PageContainer from '@/components/layout/page-container';
import { StoreDetailScreen } from '@/features/admin/store-detail';

export const metadata = { title: 'Store' };

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer
      pageTitle='Store'
      pageDescription='Details, licence, devices and support for one store.'
    >
      <StoreDetailScreen id={id} />
    </PageContainer>
  );
}
