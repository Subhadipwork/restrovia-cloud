import PageContainer from '@/components/layout/page-container';
import { AlertsScreen } from '@/features/account/alerts';

export const metadata = { title: 'Alerts' };

export default function AlertsPage() {
  return (
    <PageContainer pageTitle='Alerts' pageDescription='Emails Restrovia sends you about your cafés.'>
      <AlertsScreen />
    </PageContainer>
  );
}
