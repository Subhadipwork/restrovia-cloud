import PageContainer from '@/components/layout/page-container';
import { WelcomeScreen } from '@/features/account/welcome';

export const metadata = { title: 'Dashboard' };

export default function OverviewPage() {
  return (
    <PageContainer pageTitle='Dashboard' pageDescription='Your café at a glance.'>
      <WelcomeScreen />
    </PageContainer>
  );
}
