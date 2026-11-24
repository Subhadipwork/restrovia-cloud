import PageContainer from '@/components/layout/page-container';
import { AddonsScreen } from '@/features/admin/addons';

export const metadata = { title: 'Add-ons' };

export default function AddonsPage() {
  return (
    <PageContainer
      pageTitle='Add-ons'
      pageDescription='Extra features stores can add on top of their plan: price, trial and who sees them.'
    >
      <AddonsScreen />
    </PageContainer>
  );
}
