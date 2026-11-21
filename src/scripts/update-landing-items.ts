import dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
  (process as any).loadEnvFile(envPath);
}

import { connectDB } from '@/lib/db';
import { LandingSection, LandingItem, CacheEntry } from '@/models';
import { generateUuidV7 } from '@/lib/crypto';
import { invalidateLandingCache } from '@/services/landing';

async function main() {
  await connectDB();

  // 1. Ensure all sections exist and enable testimonials and faq
  await LandingSection.updateMany(
    { type: { $in: ['hero', 'social_proof', 'features', 'product_showcase', 'use_cases', 'pricing', 'categories', 'testimonials', 'faq', 'cta'] } },
    { $set: { is_enabled: true } }
  );

  const sections = await LandingSection.find({}).lean();
  const secMap = new Map(sections.map((s) => [s.type, s._id]));

  // 2. Exact PHP Items
  const phpItems: Record<string, Array<Record<string, unknown>>> = {
    hero: [
      { name: 'TechCorp', initial: 'T', color: 'bg-blue-500' },
      { name: 'StartupHQ', initial: 'S', color: 'bg-green-500' },
      { name: 'DesignCo', initial: 'D', color: 'bg-purple-500' },
      { name: 'DevAgency', initial: 'A', color: 'bg-orange-500' },
      { name: 'BuilderInc', initial: 'B', color: 'bg-pink-500' },
    ],
    features: [
      { title: 'AI-Powered Development', description: 'Describe what you want, and watch it come to life. Our AI understands context and builds complete applications.', icon: 'Sparkles', size: 'large' },
      { title: 'Real-time Preview', description: 'See your changes instantly as the AI builds your project. No waiting, no refreshing.', icon: 'Eye', size: 'medium' },
      { title: 'Built-in Code Editor', description: 'Full Monaco editor with syntax highlighting, file tree, and code completion.', icon: 'Code', size: 'medium' },
      { title: 'Export & Deploy', description: 'Host on our platform or export your code to deploy anywhere.', icon: 'Download', size: 'small' },
      { title: 'Smart Templates', description: 'Start with AI-selected templates that match your project needs perfectly.', icon: 'LayoutTemplate', size: 'small' },
      { title: 'Iterative Refinement', description: 'Keep chatting to refine and improve your creation until it\'s perfect.', icon: 'MessageSquare', size: 'small' },
      { title: 'Custom Subdomains', description: 'Publish your project to a custom subdomain and share it with the world.', icon: 'Globe', size: 'small' },
    ],
    use_cases: [
      { title: 'Developers', description: 'Accelerate your workflow with AI-assisted development. Focus on logic while AI handles boilerplate.', icon: 'Terminal' },
      { title: 'Entrepreneurs', description: 'Launch your MVP faster. Go from idea to working prototype in minutes, not weeks.', icon: 'Rocket' },
      { title: 'Designers', description: 'Bring your designs to life without writing code. Describe your vision and see it built.', icon: 'Palette' },
      { title: 'Agencies', description: 'Deliver more projects in less time. Scale your output without scaling your team.', icon: 'Building' },
    ],
    categories: [
      { name: 'Landing Pages', icon: 'Layout' },
      { name: 'Dashboards', icon: 'LayoutDashboard' },
      { name: 'E-commerce', icon: 'ShoppingCart' },
      { name: 'Portfolios', icon: 'Briefcase' },
      { name: 'Web Apps', icon: 'Globe' },
      { name: 'Admin Panels', icon: 'Settings' },
    ],
    testimonials: [
      { quote: 'This tool completely changed how we build prototypes. What used to take weeks now takes hours.', author: 'Sarah Chen', role: 'Product Manager at TechStart', avatar: null, rating: 5 },
      { quote: 'The AI understands exactly what I want. It\'s like having a senior developer on my team.', author: 'Marcus Johnson', role: 'Founder at BuildFast', avatar: null, rating: 5 },
      { quote: 'I launched my startup\'s website in a single afternoon. Absolutely incredible.', author: 'Emily Rodriguez', role: 'CEO at LaunchPad', avatar: null, rating: 5 },
    ],
    faq: [
      { question: 'How does the AI build websites?', answer: 'Our AI analyzes your description and generates clean, production-ready code. It understands context, follows best practices, and creates responsive designs automatically.' },
      { question: 'Can I export my code?', answer: 'Yes! You can export your complete project as a zip file and deploy it anywhere. The code is clean, well-organized, and uses modern frameworks.' },
      { question: 'What technologies are supported?', answer: 'We support modern web technologies including React, Vue, Tailwind CSS, and more. The AI selects the best stack based on your project requirements.' },
      { question: 'Is there a free plan?', answer: 'Yes, we offer a free plan with limited build credits so you can try the platform. Upgrade anytime to unlock more features and credits.' },
    ],
  };

  // Delete old landing items and insert fresh exact PHP items
  await LandingItem.deleteMany({});
  let totalInserted = 0;
  for (const [secType, list] of Object.entries(phpItems)) {
    const secId = secMap.get(secType);
    if (!secId) continue;
    for (let i = 0; i < list.length; i++) {
      await LandingItem.create({
        section_id: secId,
        locale: 'en',
        item_key: generateUuidV7(),
        sort_order: i,
        is_enabled: true,
        data: list[i],
      });
      totalInserted++;
    }
  }

  // Invalidate landing config cache
  await invalidateLandingCache();
  await CacheEntry.deleteMany({ key: { $regex: 'landing' } });

  console.log(`Successfully updated landing sections and inserted ${totalInserted} exact PHP landing items!`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to update landing items:', err);
  process.exit(1);
});
