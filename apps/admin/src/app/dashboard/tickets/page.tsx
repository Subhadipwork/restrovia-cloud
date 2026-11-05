import PageContainer from '@/components/layout/page-container';
import { TicketsScreen } from '@/features/admin/tickets';

export const metadata = { title: 'Support' };

export default function TicketsPage() {
  return (
    <PageContainer
      pageTitle='Support'
      pageDescription='Tickets sent from the Help screen in Restrovia POS.'
    >
      <TicketsScreen />
    </PageContainer>
  );
}
