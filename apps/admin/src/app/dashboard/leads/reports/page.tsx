import PageContainer from '@/components/layout/page-container';
import { ReportsScreen } from '@/features/leads/reports';

export const metadata = { title: 'Sales reports' };

export default function SalesReportsPage() {
  return (
    <PageContainer
      pageTitle='Sales reports'
      pageDescription='How leads move through the pipeline, where they come from and why they are lost.'
    >
      <ReportsScreen />
    </PageContainer>
  );
}
