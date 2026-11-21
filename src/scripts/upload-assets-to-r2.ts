import { uploadImageLibraryToR2, seedTemplates } from '@/services/seeders';

async function main() {
  console.log('Uploading 132 image-library PNGs and default-template.zip to Cloudflare R2...');
  const res = await uploadImageLibraryToR2();
  await seedTemplates();
  console.log(`Done! Uploaded ${res.uploaded} image-library assets (skipped=${res.skipped}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('R2 upload failed:', err);
  process.exit(1);
});
