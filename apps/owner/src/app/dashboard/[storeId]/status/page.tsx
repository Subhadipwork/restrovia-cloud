import PageContainer from '@/components/layout/page-container';
import { StatusScreen } from '@/features/stores/status';

export const metadata = { title: 'POS status' };

export default async function StatusPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return (
    <PageContainer pageTitle='POS status' pageDescription='Whether your café’s POS is online.'>
      <StatusScreen storeId={storeId} />
    </PageContainer>
  );
}
