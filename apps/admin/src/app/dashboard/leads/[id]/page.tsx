import PageContainer from '@/components/layout/page-container';
import { LeadDetailScreen } from '@/features/leads/lead-detail';

export const metadata = { title: 'Lead' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer pageTitle='Lead' pageDescription='Stage, follow-ups and history for one lead.'>
      <LeadDetailScreen id={id} />
    </PageContainer>
  );
}
