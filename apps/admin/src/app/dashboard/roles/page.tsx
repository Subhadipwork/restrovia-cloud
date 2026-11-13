import PageContainer from '@/components/layout/page-container';
import { RolesScreen } from '@/features/admin/roles';

export const metadata = { title: 'Roles' };

export default function RolesPage() {
  return (
    <PageContainer
      pageTitle="Roles"
      pageDescription="What each kind of admin can see and do. Every admin has one role."
    >
      <RolesScreen />
    </PageContainer>
  );
}
