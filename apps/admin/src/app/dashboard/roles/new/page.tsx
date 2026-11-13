import PageContainer from '@/components/layout/page-container';
import { RoleEditorScreen } from '@/features/admin/roles';

export const metadata = { title: 'New role' };

export default async function NewRolePage({
  searchParams
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <PageContainer pageTitle='New role' pageDescription='Name the role and choose what it allows.'>
      <RoleEditorScreen from={from} />
    </PageContainer>
  );
}
