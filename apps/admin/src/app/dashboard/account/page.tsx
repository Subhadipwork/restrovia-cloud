import PageContainer from '@/components/layout/page-container';
import { AccountScreen } from '@/features/admin/account';

export const metadata = { title: 'My account' };

export default function AccountPage() {
  return (
    <PageContainer
      pageTitle='My account'
      pageDescription='Your name, password, two-step sign-in and signed-in browsers.'
    >
      <AccountScreen />
    </PageContainer>
  );
}
