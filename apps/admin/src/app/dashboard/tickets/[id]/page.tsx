import PageContainer from '@/components/layout/page-container';
import { TicketDetailScreen } from '@/features/admin/tickets';

export const metadata = { title: 'Support ticket' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer pageTitle='Support ticket'>
      <TicketDetailScreen id={id} />
    </PageContainer>
  );
}
