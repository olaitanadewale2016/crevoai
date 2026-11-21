import Database from '@/Pages/Install/Database';

export const dynamic = 'force-dynamic';

export default function InstallDatabasePage() {
  return <Database sqliteAvailable={false} />;
}
