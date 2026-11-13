import PageContainer from '@/components/layout/page-container';
import { UserDetailScreen } from '@/features/admin/user-detail';

export const metadata = { title: 'User' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer pageTitle='User' pageDescription='Account, sign-ins, permissions and activity.'>
      <UserDetailScreen id={id} />
    </PageContainer>
  );
}
