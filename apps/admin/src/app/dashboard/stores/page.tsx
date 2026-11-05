import PageContainer from '@/components/layout/page-container';
import { StoresScreen } from '@/features/admin/stores-list';

export const metadata = { title: 'Stores' };

export default function StoresPage() {
  return (
    <PageContainer
      pageTitle='Stores'
      pageDescription='Cafés and restaurants running Restrovia POS.'
    >
      <StoresScreen />
    </PageContainer>
  );
}
