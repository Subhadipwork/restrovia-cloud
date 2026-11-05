import PageContainer from '@/components/layout/page-container';
import { OverviewScreen } from '@/features/admin/overview';

export const metadata = { title: 'Dashboard' };

export default function OverviewPage() {
  return (
    <PageContainer pageTitle='Dashboard' pageDescription='Every Restrovia POS store at a glance.'>
      <OverviewScreen />
    </PageContainer>
  );
}
