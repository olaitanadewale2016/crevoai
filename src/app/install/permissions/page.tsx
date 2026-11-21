import Permissions from '@/Pages/Install/Permissions';

export const dynamic = 'force-dynamic';

export default function InstallPermissionsPage() {
  const permissions = {
    '.env': true,
    'public/': true,
    'temp/': true,
    'uploads/': true,
  };

  return <Permissions permissions={permissions} />;
}
