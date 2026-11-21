import dns from 'dns';
import fs from 'fs';
import path from 'path';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
  (process as any).loadEnvFile(envPath);
}

import { runAllSeeders } from '@/services/seeders';

async function main() {
  console.log('Running Crevo MongoDB seeders...');
  await runAllSeeders(true);
  console.log('All seeders completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeder failed:', err);
  process.exit(1);
});
