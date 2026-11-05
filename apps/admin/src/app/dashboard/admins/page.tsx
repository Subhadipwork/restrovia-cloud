import PageContainer from '@/components/layout/page-container';
import { AdminsScreen } from '@/features/admin/admins';

export const metadata = { title: 'Admins' };

export default function AdminsPage() {
  return (
    <PageContainer
      pageTitle='Admins'
      pageDescription='Your team’s access to this panel. Every admin uses two-step sign-in.'
    >
      <AdminsScreen />
    </PageContainer>
  );
}
