import PageContainer from '@/components/layout/page-container';
import { AuditLogScreen } from '@/features/admin/audit-log';

export const metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  return (
    <PageContainer
      pageTitle='Audit log'
      pageDescription='Every sign-in and every change made in this panel. Entries can’t be edited or deleted.'
    >
      <AuditLogScreen />
    </PageContainer>
  );
}
