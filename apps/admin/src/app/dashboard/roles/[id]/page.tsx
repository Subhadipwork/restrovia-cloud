import PageContainer from '@/components/layout/page-container';
import { RoleEditorScreen } from '@/features/admin/roles';

export const metadata = { title: 'Role' };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer pageTitle='Role' pageDescription='What this role allows, and who has it.'>
      <RoleEditorScreen id={id} />
    </PageContainer>
  );
}
