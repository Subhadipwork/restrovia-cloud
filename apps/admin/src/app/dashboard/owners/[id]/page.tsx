import PageContainer from '@/components/layout/page-container';
import { OwnerDetailScreen } from '@/features/admin/owners';

export const metadata = { title: 'Owner' };

export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer
      pageTitle='Owner'
      pageDescription='Account, linked stores and recent sign-ins for one owner.'
    >
      <OwnerDetailScreen id={id} />
    </PageContainer>
  );
}
