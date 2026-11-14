import PageContainer from '@/components/layout/page-container';
import { AdminsScreen } from '@/features/admin/admins';

export const metadata = { title: 'Users' };

export default function AdminsPage() {
  return (
    <PageContainer
      pageTitle='Users'
      pageDescription='Who can sign in to this panel, and their role. Two-step sign-in with an authenticator app is optional.'
    >
      <AdminsScreen />
    </PageContainer>
  );
}
