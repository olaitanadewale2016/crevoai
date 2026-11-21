import Welcome from '@/Pages/Welcome';
import { getSharedAppProps } from '@/services/shared-context';

export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const shared = await getSharedAppProps();

  return (
    <Welcome
      {...(shared as any)}
      canLogin={true}
      canRegister={Boolean(shared.appSettings?.enable_registration ?? true)}
    />
  );
}
