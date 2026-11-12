import PageContainer from '@/components/layout/page-container';
import { StoreHistoryScreen } from '@/features/admin/store-history-page';

export const metadata = { title: 'Store history' };

export default async function StoreHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer
      pageTitle='Store history'
      pageDescription='Online time, order flow and sales over time for one store.'
    >
      <StoreHistoryScreen id={id} />
    </PageContainer>
  );
}
