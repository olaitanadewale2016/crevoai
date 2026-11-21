import Requirements from '@/Pages/Install/Requirements';

export const dynamic = 'force-dynamic';

export default function InstallRequirementsPage() {
  const dependencies = {
    'Node.js 18+': true,
    'MongoDB Driver': true,
    'OpenSSL / Crypto': true,
    'Cloudflare R2 / S3 Client': true,
    'Fetch / cURL': true,
    'JSON Support': true,
    'Buffer & Streams': true,
    'File System Access': true,
    'Process & Workers': true,
    'Native WebSockets': true,
    'Sharp / Image Processing': true,
    'BCrypt / Hashing': true,
    'Memory Limit (512M+)': true,
    'PDO SQLite (Optional)': false,
  };

  return <Requirements dependencies={dependencies} />;
}
