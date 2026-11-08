import PageContainer from '@/components/layout/page-container';
import { OwnersScreen } from '@/features/admin/owners';

export const metadata = { title: 'Owners' };

export default function OwnersPage() {
  return (
    <PageContainer
      pageTitle='Owners'
      pageDescription='Owner portal accounts: café owners and their managers.'
    >
      <OwnersScreen />
    </PageContainer>
  );
}
