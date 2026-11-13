import PageContainer from '@/components/layout/page-container';
import { BoardScreen } from '@/features/leads/board';

export const metadata = { title: 'Pipeline' };

export default function PipelinePage() {
  return (
    <PageContainer
      pageTitle='Pipeline'
      pageDescription='Open leads by stage, with this month’s wins and losses.'
    >
      <BoardScreen />
    </PageContainer>
  );
}
