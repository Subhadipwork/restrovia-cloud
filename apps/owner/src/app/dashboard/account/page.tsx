import PageContainer from '@/components/layout/page-container';
import { ProfileScreen } from '@/features/account/profile';

export const metadata = { title: 'Profile' };

export default function ProfilePage() {
  return (
    <PageContainer pageTitle='Profile' pageDescription='Your name, phone and sign-in email.'>
      <ProfileScreen />
    </PageContainer>
  );
}
