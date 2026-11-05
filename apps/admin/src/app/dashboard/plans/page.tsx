import PageContainer from '@/components/layout/page-container';
import { PlansScreen } from '@/features/admin/plans';

export const metadata = { title: 'Plans' };

export default function PlansPage() {
  return (
    <PageContainer
      pageTitle='Plans'
      pageDescription='What you sell to stores: price, billing period and how many POS computers each plan covers.'
    >
      <PlansScreen />
    </PageContainer>
  );
}
