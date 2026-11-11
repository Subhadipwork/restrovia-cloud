import PageContainer from '@/components/layout/page-container';
import { OutletsScreen } from '@/features/stores/outlets';

export const metadata = { title: 'All outlets' };

export default function OutletsPage() {
  return (
    <PageContainer
      pageTitle='All outlets'
      pageDescription='Every café you’re linked to, side by side.'
    >
      <OutletsScreen />
    </PageContainer>
  );
}
