import PageContainer from '@/components/layout/page-container';
import { LeadsScreen } from '@/features/leads/leads-list';

export const metadata = { title: 'Leads' };

export default function LeadsPage() {
  return (
    <PageContainer
      pageTitle='Leads'
      pageDescription='Cafés and restaurants we are working to sign up.'
    >
      <LeadsScreen />
    </PageContainer>
  );
}
