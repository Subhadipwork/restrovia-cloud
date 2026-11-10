import PageContainer from '@/components/layout/page-container';
import { SecurityScreen } from '@/features/account/security';

export const metadata = { title: 'Security' };

export default function SecurityPage() {
  return (
    <PageContainer
      pageTitle='Security'
      pageDescription='Password, two-factor authentication and signed-in devices.'
    >
      <SecurityScreen />
    </PageContainer>
  );
}
