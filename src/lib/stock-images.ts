/**
 * Stock Images Engine
 * Provides local stock image library, rich multi-industry curated photography,
 * dynamic search, and custom uploaded stock images for the AI builder.
 */

export interface StockImageItem {
  filename: string;
  url: string;
  type: 'background' | 'gallery';
  subject: string;
  category: string;
  categories: string[];
  mood?: string;
  tone: 'light' | 'dark' | 'warm' | 'cool' | 'neutral';
  contrast: 'dark-text' | 'light-text';
  alt: string;
  source: 'local' | 'curated' | 'custom' | 'dynamic';
}

// 60 Local Background Images from PHP
const LOCAL_BACKGROUND_FILENAMES = [
  'bg_amber-bokeh_atmosphere_warm_dark_light-text.png',
  'bg_amber-flow_abstract_warm_light_dark-text.png',
  'bg_arctic-horizon_gradient_cool_light_dark-text.png',
  'bg_blush-curves_gradient_soft_light_dark-text.png',
  'bg_bronze-drape_abstract_warm_dark_light-text.png',
  'bg_bronze-satin_texture_warm_light_dark-text.png',
  'bg_calacatta-gold_texture_soft_light_dark-text.png',
  'bg_canvas-weave_texture_soft_light_dark-text.png',
  'bg_carrara-gold_texture_soft_light_dark-text.png',
  'bg_caustic-rings_abstract_warm_light_dark-text.png',
  'bg_cement-grain_texture_neutral_light_dark-text.png',
  'bg_champagne-silk_abstract_soft_light_dark-text.png',
  'bg_charred-asphalt_texture_earthy_dark_light-text.png',
  'bg_cobalt-plume_abstract_cool_light_dark-text.png',
  'bg_copper-dunes_abstract_warm_warm_light-text.png',
  'bg_coral-swirl_abstract_playful_light_dark-text.png',
  'bg_cracked-earth_texture_earthy_warm_dark-text.png',
  'bg_cream-pebbles_abstract_soft_light_dark-text.png',
  'bg_desert-cliff_texture_earthy_light_dark-text.png',
  'bg_dusty-glow_atmosphere_warm_dark_light-text.png',
  'bg_eclipse-glow_gradient_moody_dark_light-text.png',
  'bg_ember-beam_gradient_warm_dark_light-text.png',
  'bg_ember-trail_atmosphere_bold_dark_light-text.png',
  'bg_frosted-hills_atmosphere_cool_light_dark-text.png',
  'bg_frosted-quartz_texture_soft_light_dark-text.png',
  'bg_gauze-folds_texture_soft_light_dark-text.png',
  'bg_golden-clouds_atmosphere_warm_light_dark-text.png',
  'bg_honey-haze_gradient_warm_light_dark-text.png',
  'bg_ice-origami_abstract_cool_light_dark-text.png',
  'bg_iridescent-silk_abstract_playful_light_dark-text.png',
  'bg_lava-crust_texture_bold_dark_light-text.png',
  'bg_linen-weave_texture_soft_light_dark-text.png',
  'bg_luminous-threads_atmosphere_warm_dark_light-text.png',
  'bg_midnight-swoop_gradient_moody_dark_light-text.png',
  'bg_mist-ribbon_gradient_cool_light_dark-text.png',
  'bg_molten-filaments_atmosphere_bold_dark_light-text.png',
  'bg_navy-folds_abstract_cool_dark_light-text.png',
  'bg_peach-petals_gradient_warm_light_dark-text.png',
  'bg_plaster-sweep_texture_soft_light_dark-text.png',
  'bg_raw-concrete_texture_earthy_neutral_dark-text.png',
  'bg_rising-steam_atmosphere_ethereal_warm_dark-text.png',
  'bg_river-pebbles_texture_earthy_neutral_dark-text.png',
  'bg_rose-silk_gradient_soft_light_dark-text.png',
  'bg_rustic-stucco_texture_soft_warm_dark-text.png',
  'bg_sage-waves_gradient_cool_light_dark-text.png',
  'bg_sand-dunes_texture_earthy_warm_dark-text.png',
  'bg_sandstone-strata_texture_earthy_warm_light-text.png',
  'bg_sepia-smoke_abstract_warm_light_dark-text.png',
  'bg_silver-veil_abstract_cool_light_dark-text.png',
  'bg_slate-crags_texture_moody_dark_light-text.png',
  'bg_spark-burst_atmosphere_bold_dark_light-text.png',
  'bg_spectrum-beam_atmosphere_moody_dark_light-text.png',
  'bg_starlit-mesh_atmosphere_ethereal_dark_light-text.png',
  'bg_sunblind-shadows_atmosphere_warm_dark_light-text.png',
  'bg_sunwash_gradient_warm_light_dark-text.png',
  'bg_teal-bokeh_atmosphere_playful_dark_light-text.png',
  'bg_teal-dunes_abstract_cool_light_dark-text.png',
  'bg_torn-strata_abstract_earthy_light_dark-text.png',
  'bg_volcanic-speckle_texture_moody_dark_light-text.png',
  'bg_window-glow_atmosphere_warm_dark_light-text.png',
];

// 72 Local Gallery Images from PHP
const LOCAL_GALLERY_FILENAMES = [
  'gal_airy-luncheon_hospitality-restaurant_light_dark-text.png',
  'gal_arched-courtyard_architecture-hospitality_warm_dark-text.png',
  'gal_arched-doorway_architecture-interior_warm_dark-text.png',
  'gal_balanced-cairn_wellness-zen_cool_light-text.png',
  'gal_blue-pigment_creative-art_cool_dark-text.png',
  'gal_blue-shutters_vintage-architecture_warm_dark-text.png',
  'gal_botanical-pump_beauty-retail_light_dark-text.png',
  'gal_bread-crumb_food-bakery_dark_light-text.png',
  'gal_brushed-steel_industrial-metalwork_cool_light-text.png',
  'gal_cafe-cortado_food-coffee_dark_light-text.png',
  'gal_candlelit-table_hospitality-restaurant_dark_light-text.png',
  'gal_ceramic-jug_craft-hospitality_warm_dark-text.png',
  'gal_champagne-pair_wine-hospitality_dark_light-text.png',
  'gal_clay-pot_craft-artisan_warm_dark-text.png',
  'gal_concentric-rings_architecture-abstract_light_dark-text.png',
  'gal_concrete-frame_architecture-minimal_light_dark-text.png',
  'gal_cotton-stalks_organic-nature_warm_dark-text.png',
  'gal_crema-topdown_food-coffee_dark_light-text.png',
  'gal_crusty-loaf_food-bakery_dark_light-text.png',
  'gal_curved-stroke_creative-art_light_dark-text.png',
  'gal_desk-journal_professional-coaching_warm_dark-text.png',
  'gal_dewdrop-macro_abstract-creative_warm_light-text.png',
  'gal_diagonal-rails_interior-editorial_cool_dark-text.png',
  'gal_draped-linen_interior-editorial_light_dark-text.png',
  'gal_dried-hydrangea_organic-floral_warm_dark-text.png',
  'gal_evening-glassware_hospitality-restaurant_dark_light-text.png',
  'gal_executive-binder_professional-coaching_warm_dark-text.png',
  'gal_fan-palm_organic-nature_warm_dark-text.png',
  'gal_forest-canopy_nature-organic_cool_dark-text.png',
  'gal_glazed-bun_food-bakery_warm_dark-text.png',
  'gal_golden-croissant_food-bakery_warm_dark-text.png',
  'gal_golden-orb_abstract-creative_dark_light-text.png',
  'gal_golden-pane_interior-editorial_warm_dark-text.png',
  'gal_harvest-loaf_food-bakery_warm_light-text.png',
  'gal_jar-roses_florist-nature_light_dark-text.png',
  'gal_kraft-bouquet_florist-nature_warm_dark-text.png',
  'gal_lake-ripples_abstract-minimal_cool_light-text.png',
  'gal_leaf-shadows_interior-editorial_warm_dark-text.png',
  'gal_linen-stance_wellness-lifestyle_warm_dark-text.png',
  'gal_marble-latte_food-coffee_light_dark-text.png',
  'gal_marble-shears_salon-grooming_light_dark-text.png',
  'gal_misty-reflection_abstract-minimal_cool_light-text.png',
  'gal_narrow-passage_architecture-hospitality_warm_dark-text.png',
  'gal_open-notebook_professional-coaching_warm_dark-text.png',
  'gal_peeling-plaster_vintage-abstract_warm_dark-text.png',
  'gal_physalis-bottle_organic-botanical_warm_dark-text.png',
  'gal_powdered-profiteroles_food-patisserie_light_dark-text.png',
  'gal_prism-cube_abstract-creative_light_dark-text.png',
  'gal_raked-garden_wellness-zen_light_dark-text.png',
  'gal_red-wine_wine-hospitality_dark_light-text.png',
  'gal_river-stones_abstract-nature_cool_light-text.png',
  'gal_rusted-beam_industrial-metalwork_dark_light-text.png',
  'gal_rusty-handle_vintage-craft_warm_dark-text.png',
  'gal_scissors-leather_salon-grooming_dark_light-text.png',
  'gal_serum-bottle_beauty-retail_light_dark-text.png',
  'gal_sheer-glow_interior-editorial_light_dark-text.png',
  'gal_shell-spiral_architecture-abstract_light_dark-text.png',
  'gal_speckled-cup_craft-hospitality_light_dark-text.png',
  'gal_splatter-wash_creative-art_warm_dark-text.png',
  'gal_stacked-plates_craft-artisan_warm_dark-text.png',
  'gal_stone-colonnade_architecture-hospitality_warm_dark-text.png',
  'gal_stone-mug_craft-hospitality_light_dark-text.png',
  'gal_summer-wine_wine-hospitality_light_dark-text.png',
  'gal_sunlit-feet_wellness-movement_light_dark-text.png',
  'gal_sunlit-stairwell_architecture-interior_light_dark-text.png',
  'gal_vintage-razor_vintage-grooming_dark_light-text.png',
  'gal_weld-seam_industrial-metalwork_dark_light-text.png',
  'gal_white-floorboard_wellness-minimal_light_dark-text.png',
  'gal_window-drape_interior-editorial_light_dark-text.png',
  'gal_woodcap-jar_beauty-retail_warm_dark-text.png',
  'gal_wooden-bowl_craft-artisan_light_dark-text.png',
  'gal_zen-circle_wellness-zen_light_dark-text.png',
];

function humanize(text: string): string {
  return text.replace(/[-_]+/g, ' ').trim();
}

export function parseLocalFilename(filename: string, baseUrl = ''): StockImageItem {
  const isBg = filename.startsWith('bg_');
  const type: 'background' | 'gallery' = isBg ? 'background' : 'gallery';
  const clean = filename.replace(/\.png$/i, '');
  const parts = clean.split('_');

  let subject = parts[1] || 'image';
  let category = parts[2] || (isBg ? 'texture' : 'general');
  let categories = category.split('-');
  let mood = '';
  let tone: StockImageItem['tone'] = 'neutral';
  let contrast: StockImageItem['contrast'] = 'dark-text';

  if (isBg && parts.length >= 6) {
    mood = parts[3] || '';
    tone = (parts[4] as any) || 'neutral';
    contrast = (parts[5] as any) || 'dark-text';
  } else if (!isBg && parts.length >= 5) {
    tone = (parts[3] as any) || 'neutral';
    contrast = (parts[4] as any) || 'dark-text';
  }

  const prefix = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const subdir = isBg ? 'backgrounds' : 'gallery';
  const url = `${prefix}/storage/image-library/${subdir}/${filename}`;

  return {
    filename,
    url,
    type,
    subject: humanize(subject),
    category: humanize(category),
    categories: categories.map(humanize),
    mood,
    tone,
    contrast,
    alt: `${humanize(subject)} - professional ${category}`,
    source: 'local',
  };
}

export const LOCAL_STOCK_IMAGES: StockImageItem[] = [
  ...LOCAL_BACKGROUND_FILENAMES.map((f) => parseLocalFilename(f)),
  ...LOCAL_GALLERY_FILENAMES.map((f) => parseLocalFilename(f)),
];

// Rich Multi-Industry Photography Catalog (Unsplash High-Speed Global CDN)
export const CURATED_INDUSTRY_IMAGES: StockImageItem[] = [
  // 1. DENTISTRY & ORAL HEALTHCARE
  {
    filename: 'curated_dentist_clinic_room.jpg',
    url: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Dental Clinic Treatment Room',
    category: 'dentist',
    categories: ['dentist', 'dental', 'teeth', 'healthcare', 'clinic', 'medical'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Bright modern dental clinic with examination chair and high-tech equipment',
    source: 'curated',
  },
  {
    filename: 'curated_dentist_doctor_consultation.jpg',
    url: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Dentist Consulting With Patient',
    category: 'dentist',
    categories: ['dentist', 'dental', 'doctor', 'patient', 'smile', 'healthcare'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Friendly female dentist explaining treatment plan to a smiling patient',
    source: 'curated',
  },
  {
    filename: 'curated_dentist_hero_background.jpg',
    url: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Modern Medical & Dental Center Reception',
    category: 'dentist',
    categories: ['dentist', 'dental', 'healthcare', 'clinic', 'hospital'],
    mood: 'soft',
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Clean minimalist dental clinic lobby and reception background',
    source: 'curated',
  },

  // 2. LAW, LEGAL & ACCOUNTING
  {
    filename: 'curated_law_office_boardroom.jpg',
    url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Scale of Justice and Law Library Books',
    category: 'law',
    categories: ['law', 'legal', 'lawyer', 'attorney', 'justice', 'court'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Golden scales of justice on mahogany desk in attorney law library',
    source: 'curated',
  },
  {
    filename: 'curated_lawyer_corporate_consulting.jpg',
    url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Executive Attorney in Law Consultation',
    category: 'law',
    categories: ['law', 'lawyer', 'corporate', 'finance', 'consulting', 'advisory'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Professional lawyer reviewing legal contracts in modern executive office',
    source: 'curated',
  },
  {
    filename: 'curated_law_hero_background.jpg',
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Modern Glass Corporate Skyscraper',
    category: 'law',
    categories: ['law', 'legal', 'corporate', 'finance', 'business', 'architecture'],
    mood: 'moody',
    tone: 'cool',
    contrast: 'light-text',
    alt: 'Imposing glass architectural skyscraper representing premier corporate legal firm',
    source: 'curated',
  },

  // 3. FITNESS, GYM & YOGA
  {
    filename: 'curated_gym_equipment_workout.jpg',
    url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Gym Weights and Training Floor',
    category: 'fitness',
    categories: ['fitness', 'gym', 'workout', 'training', 'weights', 'crossfit'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'High-end fitness center with dumbbells and professional strength training equipment',
    source: 'curated',
  },
  {
    filename: 'curated_gym_personal_trainer.jpg',
    url: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Athletic Workout and Training Session',
    category: 'fitness',
    categories: ['fitness', 'gym', 'trainer', 'exercise', 'health', 'wellness'],
    tone: 'cool',
    contrast: 'light-text',
    alt: 'Athletic personal training workout session in premium sports gym',
    source: 'curated',
  },
  {
    filename: 'curated_yoga_studio_zen.jpg',
    url: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Peaceful Yoga and Meditation Studio',
    category: 'fitness',
    categories: ['fitness', 'yoga', 'meditation', 'wellness', 'pilates', 'zen'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Serene yoga meditation practice in sunlit wood floor studio',
    source: 'curated',
  },
  {
    filename: 'curated_gym_hero_bg.jpg',
    url: 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Atmospheric Fitness Center Lights',
    category: 'fitness',
    categories: ['fitness', 'gym', 'sports', 'training'],
    mood: 'bold',
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Dramatic moody lighting over modern gym workout studio',
    source: 'curated',
  },

  // 4. AUTOMOTIVE, MECHANICS & CAR REPAIR
  {
    filename: 'curated_auto_mechanic_workshop.jpg',
    url: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Mechanic Inspecting Vehicle Engine',
    category: 'automotive',
    categories: ['automotive', 'mechanic', 'car', 'repair', 'garage', 'service', 'auto'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Professional auto mechanic checking engine bay under workshop lights',
    source: 'curated',
  },
  {
    filename: 'curated_auto_detailing_car.jpg',
    url: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Luxury Car Detailing & Polishing',
    category: 'automotive',
    categories: ['automotive', 'car', 'detailing', 'wash', 'dealership', 'luxury'],
    tone: 'cool',
    contrast: 'light-text',
    alt: 'High-gloss ceramic coating and detailing on sports car',
    source: 'curated',
  },
  {
    filename: 'curated_auto_garage_bg.jpg',
    url: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Sleek Supercar on Open Road',
    category: 'automotive',
    categories: ['automotive', 'car', 'speed', 'racing', 'dealership'],
    mood: 'bold',
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Sleek luxury sports car driving at twilight speed',
    source: 'curated',
  },

  // 5. TECH, SAAS, AI & SOFTWARE
  {
    filename: 'curated_tech_saas_dashboard.jpg',
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Analytics Data Dashboard on Display',
    category: 'technology',
    categories: ['technology', 'tech', 'saas', 'software', 'analytics', 'dashboard', 'ai'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Modern web application business analytics dashboard with charts and metrics',
    source: 'curated',
  },
  {
    filename: 'curated_tech_developer_coding.jpg',
    url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Software Engineer Laptop and Coffee',
    category: 'technology',
    categories: ['technology', 'code', 'software', 'startup', 'programming', 'developer'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Clean workspace with laptop showing code alongside coffee and notebook',
    source: 'curated',
  },
  {
    filename: 'curated_tech_datacenter_ai_bg.jpg',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'High-Tech Circuit Board and Microchip',
    category: 'technology',
    categories: ['technology', 'ai', 'cloud', 'cybersecurity', 'hardware', 'future'],
    mood: 'moody',
    tone: 'cool',
    contrast: 'light-text',
    alt: 'Luminous blue glowing microchip and circuit board futuristic technology background',
    source: 'curated',
  },

  // 6. PETS, VETERINARY & DOG GROOMING
  {
    filename: 'curated_pet_vet_examining_dog.jpg',
    url: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Adorable Golden Retriever Dog',
    category: 'pets',
    categories: ['pets', 'pet', 'dog', 'veterinary', 'vet', 'animals', 'grooming'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Happy healthy golden retriever dog looking at camera with friendly smile',
    source: 'curated',
  },
  {
    filename: 'curated_pet_veterinarian_clinic.jpg',
    url: 'https://images.unsplash.com/photo-1628009368231-7bb7cfcb0def?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Veterinarian Checking Puppy Health',
    category: 'pets',
    categories: ['pets', 'vet', 'clinic', 'puppy', 'veterinary', 'care', 'hospital'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Gentle veterinarian caring for small puppy during wellness clinic exam',
    source: 'curated',
  },
  {
    filename: 'curated_pet_cat_cozy.jpg',
    url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Cute Fluffy Cat Close-Up',
    category: 'pets',
    categories: ['pets', 'cat', 'feline', 'animals', 'care'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Cute domestic cat resting peacefully in warm natural sunlight',
    source: 'curated',
  },

  // 7. REAL ESTATE, ARCHITECTURE & HOME DECOR
  {
    filename: 'curated_realestate_modern_villa.jpg',
    url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Luxury Modern House Architecture with Pool',
    category: 'real-estate',
    categories: ['real-estate', 'house', 'villa', 'property', 'architecture', 'realtor', 'home'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Striking contemporary residential luxury villa with swimming pool and garden patio',
    source: 'curated',
  },
  {
    filename: 'curated_realestate_living_room.jpg',
    url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Designer Minimalist Living Room Interior',
    category: 'real-estate',
    categories: ['real-estate', 'interior', 'furniture', 'decor', 'apartment', 'architecture'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Spacious minimalist living room with warm wood accents and abundant natural sunlight',
    source: 'curated',
  },
  {
    filename: 'curated_realestate_hero_bg.jpg',
    url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Sunlit Luxury Home Exterior Background',
    category: 'real-estate',
    categories: ['real-estate', 'home', 'property', 'residence'],
    mood: 'warm',
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Stunning luxury home facade against blue sky and manicured lawn',
    source: 'curated',
  },

  // 8. PLUMBING, HVAC, ELECTRICAL & TRADES
  {
    filename: 'curated_plumbing_pipes_repair.jpg',
    url: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Plumber Tools and Copper Pipe Repair',
    category: 'plumbing',
    categories: ['plumbing', 'plumber', 'repair', 'pipes', 'hvac', 'contractor', 'trades'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Professional plumbing wrench tightening copper water pipes under kitchen sink',
    source: 'curated',
  },
  {
    filename: 'curated_construction_electrician_tools.jpg',
    url: 'https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Construction Engineer with Blueprint on Site',
    category: 'construction',
    categories: ['construction', 'builder', 'contractor', 'electrician', 'architecture', 'roofing'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Architect in protective hardhat examining structural plans at construction site',
    source: 'curated',
  },

  // 9. BEAUTY, HAIR SALON, BARBER & SPA
  {
    filename: 'curated_hair_salon_styling.jpg',
    url: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Hair Salon Chair & Mirrors',
    category: 'beauty',
    categories: ['beauty', 'hair', 'salon', 'barber', 'hairdresser', 'styling'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Chic modern hair salon station with styling mirrors and leather chairs',
    source: 'curated',
  },
  {
    filename: 'curated_barber_shop_trim.jpg',
    url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Vintage Barber Shop Beard Grooming',
    category: 'barber',
    categories: ['barber', 'shave', 'grooming', 'haircut', 'men', 'salon'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Classic gentleman barber grooming customer with straight razor and vintage tools',
    source: 'curated',
  },
  {
    filename: 'curated_spa_massage_stones.jpg',
    url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Relaxing Luxury Spa Treatment with Hot Stones',
    category: 'spa',
    categories: ['spa', 'wellness', 'massage', 'relaxation', 'skincare', 'beauty'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Aromatic wellness spa treatment with volcanic hot stones, towels and orchids',
    source: 'curated',
  },

  // 10. RESTAURANTS, DINING, PIZZA & BARS
  {
    filename: 'curated_restaurant_fine_dining.jpg',
    url: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Gourmet Chef Plating Culinary Dish',
    category: 'restaurant',
    categories: ['restaurant', 'dining', 'food', 'chef', 'gourmet', 'culinary', 'dinner'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Artisanal culinary dish prepared with exquisite presentation in upscale bistro',
    source: 'curated',
  },
  {
    filename: 'curated_pizza_woodfired_oven.jpg',
    url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Fresh Neapolitan Pizza with Basil and Mozzarella',
    category: 'restaurant',
    categories: ['pizza', 'italian', 'restaurant', 'food', 'bakery', 'pizzeria'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Crispy wood-fired Neapolitan artisan pizza with fresh melted mozzarella and fragrant basil',
    source: 'curated',
  },
  {
    filename: 'curated_cocktail_bar_night.jpg',
    url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Craft Cocktail with Garnish at Trendy Bar',
    category: 'bar',
    categories: ['bar', 'cocktail', 'drinks', 'nightlife', 'pub', 'restaurant', 'lounge'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Handcrafted signature cocktail on illuminated wooden bar counter',
    source: 'curated',
  },

  // 11. CLEANING & MAID SERVICES
  {
    filename: 'curated_cleaning_supplies_kitchen.jpg',
    url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Professional Eco Cleaning Supplies & Gloves',
    category: 'cleaning',
    categories: ['cleaning', 'maid', 'housekeeping', 'clean', 'janitorial', 'home'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Eco-friendly cleaning spray bottles, microfiber cloths and yellow gloves in sparkling kitchen',
    source: 'curated',
  },
  {
    filename: 'curated_cleaning_living_clean.jpg',
    url: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Spotless Bright Clean Home Interior',
    category: 'cleaning',
    categories: ['cleaning', 'home', 'room', 'tidy', 'maid', 'sparkle'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Spotlessly clean, organized modern home living area bathed in morning light',
    source: 'curated',
  },

  // 12. EDUCATION, TUTORING & BOOKS
  {
    filename: 'curated_education_library_books.jpg',
    url: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'University Library Bookshelves and Study Desk',
    category: 'education',
    categories: ['education', 'school', 'university', 'library', 'books', 'tutoring', 'study'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Atmospheric college library with rows of academic books and open reading desk',
    source: 'curated',
  },
  {
    filename: 'curated_education_student_learning.jpg',
    url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Collaborative Students Study Group',
    category: 'education',
    categories: ['education', 'students', 'learning', 'course', 'college', 'tutor'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Engaged university students discussing coursework together around laptop and notes',
    source: 'curated',
  },

  // 13. PHOTOGRAPHY, CREATIVE & ART
  {
    filename: 'curated_photo_camera_lens.jpg',
    url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Professional Mirrorless Camera and Prime Lens',
    category: 'photography',
    categories: ['photography', 'camera', 'photo', 'creative', 'video', 'lens', 'photographer'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'High-end professional camera body with large glass lens on minimalist table',
    source: 'curated',
  },
  {
    filename: 'curated_creative_designer_studio.jpg',
    url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Creative Design Studio Moodboard',
    category: 'creative',
    categories: ['creative', 'design', 'agency', 'art', 'branding', 'studio'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Brand identity color palettes, typography swatches and design sketches on creative desk',
    source: 'curated',
  },

  // 14. TRAVEL, HOTELS & VACATION RENTALS
  {
    filename: 'curated_travel_tropical_resort.jpg',
    url: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Tropical Resort Swimming Pool with Palm Trees',
    category: 'travel',
    categories: ['travel', 'hotel', 'resort', 'vacation', 'tourism', 'holiday', 'tropical'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Crystal turquoise swimming pool surrounded by tropical palm trees and sun loungers',
    source: 'curated',
  },
  {
    filename: 'curated_travel_mountain_lake_bg.jpg',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80',
    type: 'background',
    subject: 'Breathtaking Alpine Mountain Lake at Sunset',
    category: 'travel',
    categories: ['travel', 'nature', 'mountains', 'landscape', 'outdoor', 'adventure'],
    mood: 'moody',
    tone: 'cool',
    contrast: 'light-text',
    alt: 'Dramatic reflective alpine lake mirror reflecting towering mountain peaks at dusk',
    source: 'curated',
  },

  // 15. E-COMMERCE, FASHION & BOUTIQUES
  {
    filename: 'curated_fashion_apparel_rack.jpg',
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Boutique Clothing Display',
    category: 'fashion',
    categories: ['fashion', 'store', 'shop', 'ecommerce', 'clothing', 'retail', 'boutique'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Curated apparel collection on minimalist metal clothing rack inside bright fashion boutique',
    source: 'curated',
  },
  {
    filename: 'curated_fashion_sneakers_shoes.jpg',
    url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Iconic Red Athletic Sneakers',
    category: 'fashion',
    categories: ['fashion', 'shoes', 'sneakers', 'ecommerce', 'product', 'retail'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Vibrant red designer athletic sneaker isolated on sleek dark backdrop',
    source: 'curated',
  },

  // 16. FINANCE, CRYPTO & WEALTH MANAGEMENT
  {
    filename: 'curated_finance_stock_trading.jpg',
    url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Financial Markets Stock Chart Display',
    category: 'finance',
    categories: ['finance', 'crypto', 'banking', 'stocks', 'investing', 'money', 'wealth'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Real-time financial candlestick market graph showing positive trading trends',
    source: 'curated',
  },

  // 17. WEDDING & EVENT PLANNING
  {
    filename: 'curated_wedding_table_flowers.jpg',
    url: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Elegant Wedding Banquet Table Setting',
    category: 'wedding',
    categories: ['wedding', 'event', 'party', 'flowers', 'catering', 'celebration'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Exquisite wedding reception dinner table arranged with lush floral bouquets and glassware',
    source: 'curated',
  },

  // 18. MUSIC & AUDIO PRODUCTION
  {
    filename: 'curated_music_studio_mic.jpg',
    url: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Professional Studio Recording Microphone',
    category: 'music',
    categories: ['music', 'audio', 'studio', 'recording', 'podcast', 'dj', 'producer'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Condenser vocal recording microphone in acoustically treated sound studio with mixing console',
    source: 'curated',
  },

  // EXPANDED MULTI-NICHE VARIETY (PREVENT IMAGE REUSE ACROSS CARDS)
  {
    filename: 'curated_bakery_pastries_display.jpg',
    url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Freshly Baked Artisan Sourdough Bread',
    category: 'restaurant',
    categories: ['restaurant', 'bakery', 'bread', 'pastry', 'food', 'cafe'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Warm crusted artisan sourdough loaves arranged in a bakery display',
    source: 'curated',
  },
  {
    filename: 'curated_bakery_croissants_coffee.jpg',
    url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Golden Croissants & Espresso Bar',
    category: 'restaurant',
    categories: ['restaurant', 'bakery', 'cafe', 'coffee', 'pastry', 'breakfast', 'food'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Freshly baked butter croissants arranged on a bakery rack',
    source: 'curated',
  },
  {
    filename: 'curated_restaurant_fine_dining.jpg',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Bistro Dining Room Interior',
    category: 'restaurant',
    categories: ['restaurant', 'dining', 'bistro', 'hospitality', 'food', 'interior'],
    tone: 'dark',
    contrast: 'light-text',
    alt: 'Ambient evening lighting in an upscale restaurant dining room',
    source: 'curated',
  },
  {
    filename: 'curated_restaurant_plated_dish.jpg',
    url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Chef Signature Plated Entree',
    category: 'restaurant',
    categories: ['restaurant', 'food', 'menu', 'chef', 'catering', 'dinner'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Overhead photograph of gourmet chef-prepared signature dishes',
    source: 'curated',
  },
  {
    filename: 'curated_tech_team_collaboration.jpg',
    url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Software Engineering Team Collaboration',
    category: 'technology',
    categories: ['technology', 'saas', 'agency', 'startup', 'software', 'team', 'business'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Product and engineering team collaborating around laptops in a sunlit workspace',
    source: 'curated',
  },
  {
    filename: 'curated_tech_dashboard_analytics.jpg',
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Cloud Analytics & Data Platform Screen',
    category: 'technology',
    categories: ['technology', 'saas', 'analytics', 'fintech', 'dashboard', 'software', 'ai'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Laptop screen showing clean financial charts and performance metrics',
    source: 'curated',
  },
  {
    filename: 'curated_tech_developer_setup.jpg',
    url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Modern Developer Desk & Code Workstation',
    category: 'technology',
    categories: ['technology', 'developer', 'coding', 'software', 'agency', 'product'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Developer laptop running application code on a minimalist desk',
    source: 'curated',
  },
  {
    filename: 'curated_beauty_skincare_serum.jpg',
    url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Luxury Facial & Skincare Treatment',
    category: 'beauty',
    categories: ['beauty', 'spa', 'skincare', 'salon', 'wellness', 'cosmetics'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Calm spa aesthetician performing facial skincare treatment',
    source: 'curated',
  },
  {
    filename: 'curated_fashion_ecommerce_store.jpg',
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Curated Boutique Apparel & Retail Store',
    category: 'fashion',
    categories: ['fashion', 'ecommerce', 'shop', 'store', 'retail', 'apparel', 'clothing'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Minimalist clothing rack inside a modern boutique retail storefront',
    source: 'curated',
  },
  {
    filename: 'curated_ecommerce_product_watch.jpg',
    url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Minimalist Product Showcase Photography',
    category: 'fashion',
    categories: ['ecommerce', 'product', 'shop', 'store', 'watch', 'accessories', 'fashion'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Clean studio product shot of a modern minimalist wristwatch',
    source: 'curated',
  },
  {
    filename: 'curated_realestate_living_interior.jpg',
    url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Contemporary Architectural Residence Exterior',
    category: 'real-estate',
    categories: ['real-estate', 'architecture', 'home', 'property', 'house', 'luxury'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Modern architectural home with glass facade and landscaped yard',
    source: 'curated',
  },
  {
    filename: 'curated_realestate_modern_kitchen.jpg',
    url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Open Concept Luxury Residence Lounge',
    category: 'real-estate',
    categories: ['real-estate', 'interior', 'design', 'apartment', 'home', 'luxury'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Spacious bright modern living room overlooking garden patio',
    source: 'curated',
  },
  {
    filename: 'curated_finance_advisory_meeting.jpg',
    url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Financial Advisory & Business Consulting Session',
    category: 'finance',
    categories: ['finance', 'accounting', 'consulting', 'law', 'tax', 'business', 'investment'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Financial consultant reviewing strategy charts and portfolio documents on desk',
    source: 'curated',
  },
  {
    filename: 'curated_medical_doctor_clinic.jpg',
    url: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80',
    type: 'gallery',
    subject: 'Healthcare Digital Consultation & Diagnostics',
    category: 'dentist',
    categories: ['medical', 'healthcare', 'clinic', 'doctor', 'hospital', 'dentist'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Healthcare specialist reviewing patient diagnostics on digital tablet',
    source: 'curated',
  },

  // HEADSHOTS, PORTRAITS, TEAM MEMBERS & TESTIMONIAL AVATARS
  {
    filename: 'curated_avatar_executive_woman.jpg',
    url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Female Business Founder Headshot',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'woman', 'founder', 'person'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Professional portrait headshot of a smiling female executive founder',
    source: 'curated',
  },
  {
    filename: 'curated_avatar_creative_man.jpg',
    url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Male Director Professional Headshot',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'man', 'ceo', 'person'],
    tone: 'cool',
    contrast: 'dark-text',
    alt: 'Studio headshot portrait of a male business leader in tailored suit',
    source: 'curated',
  },
  {
    filename: 'curated_avatar_designer_woman.jpg',
    url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Friendly Customer Testimonial Portrait',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'woman', 'customer', 'review'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Warm portrait of a smiling woman for testimonial or team profile',
    source: 'curated',
  },
  {
    filename: 'curated_avatar_engineer_man.jpg',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Product Specialist Headshot Portrait',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'man', 'developer', 'client'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Friendly portrait headshot of a young product specialist',
    source: 'curated',
  },
  {
    filename: 'curated_avatar_consultant_woman.jpg',
    url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Client Testimonial Woman Portrait',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'woman', 'client', 'profile'],
    tone: 'warm',
    contrast: 'dark-text',
    alt: 'Natural portrait photograph of a satisfied client smiling',
    source: 'curated',
  },
  {
    filename: 'curated_avatar_founder_man.jpg',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
    type: 'gallery',
    subject: 'Customer Profile Avatar Man',
    category: 'avatar',
    categories: ['avatar', 'portrait', 'headshot', 'testimonial', 'team', 'man', 'customer', 'profile'],
    tone: 'light',
    contrast: 'dark-text',
    alt: 'Close-up portrait of a smiling male customer',
    source: 'curated',
  },
];

// Combine all libraries into a master list
export const ALL_PRESET_IMAGES: StockImageItem[] = [
  ...LOCAL_STOCK_IMAGES,
  ...CURATED_INDUSTRY_IMAGES,
];

const DYNAMIC_FALLBACK_POOL = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80',
];

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface SearchStockImagesOptions {
  query?: string;
  category?: string;
  type?: 'background' | 'gallery';
  mood?: string;
  tone?: string;
  limit?: number;
  index?: number;
  seed?: string;
  customImages?: StockImageItem[];
  baseUrl?: string;
}

export function searchStockImages(opts: SearchStockImagesOptions): StockImageItem[] {
  const {
    query = '',
    category = '',
    type,
    mood = '',
    tone = '',
    limit = 10,
    index,
    seed = '',
    customImages = [],
    baseUrl = '',
  } = opts;

  const rawKeywords = [query, category].filter(Boolean).join(' ').toLowerCase();
  const searchTokens = rawKeywords
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  // Pool: custom user images first, then curated industry images, then local library
  const pool: StockImageItem[] = [
    ...customImages,
    ...CURATED_INDUSTRY_IMAGES,
    ...LOCAL_STOCK_IMAGES,
  ];

  const scored: Array<{ item: StockImageItem; score: number }> = [];

  for (const img of pool) {
    if (type && img.type !== type) continue;
    if (mood && img.mood && img.mood.toLowerCase() !== mood.toLowerCase()) continue;
    if (tone && img.tone.toLowerCase() !== tone.toLowerCase()) continue;

    let score = 0;

    if (searchTokens.length === 0) {
      // No filter, default relevance
      score = img.source === 'custom' ? 100 : img.source === 'curated' ? 50 : 20;
    } else {
      const subjectLower = img.subject.toLowerCase();
      const categoryLower = img.category.toLowerCase();
      const categoriesLower = img.categories.map((c) => c.toLowerCase());
      const altLower = img.alt.toLowerCase();

      for (const token of searchTokens) {
        if (categoriesLower.some((c) => c === token)) score += 30;
        else if (categoriesLower.some((c) => c.includes(token))) score += 18;

        if (categoryLower === token) score += 25;
        else if (categoryLower.includes(token)) score += 15;

        if (subjectLower.includes(token)) score += 20;
        if (altLower.includes(token)) score += 10;
      }

      if (score === 0) {
        // Partial substring check
        const joined = `${img.subject} ${img.category} ${img.categories.join(' ')} ${img.alt}`.toLowerCase();
        if (searchTokens.some((t) => joined.includes(t))) {
          score = 5;
        }
      }
    }

    if (score > 0) {
      if (img.source === 'custom') score += 50;
      scored.push({ item: img, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit).map((s) => s.item);

  // Fallback: If 0 matches found for a specific query, pick a deterministic image from the multi-photo pool
  if (results.length === 0 && searchTokens.length > 0) {
    const topic = searchTokens.join('-');
    const displayTopic = searchTokens.join(' ');
    const isBg = type === 'background';
    const slot =
      index !== undefined
        ? Math.abs(index)
        : hashSeed(`${rawKeywords}|${seed}|${type || ''}`);
    const fallbackDynamic: StockImageItem = {
      filename: `dynamic_${topic}_${slot}_${type || 'gallery'}.jpg`,
      url: DYNAMIC_FALLBACK_POOL[slot % DYNAMIC_FALLBACK_POOL.length],
      type: type || 'gallery',
      subject: humanize(displayTopic),
      category: searchTokens[0] || 'custom',
      categories: searchTokens,
      mood: isBg ? 'atmosphere' : '',
      tone: 'light',
      contrast: 'dark-text',
      alt: `${displayTopic} professional photography`,
      source: 'dynamic',
    };

    results.push(fallbackDynamic);
  }

  // Ensure baseUrl is applied if provided
  if (baseUrl) {
    return results.map((img) => {
      if (img.url.startsWith('/storage/')) {
        return {
          ...img,
          url: `${baseUrl.replace(/\/+$/, '')}${img.url}`,
        };
      }
      return img;
    });
  }

  return results;
}

export function formatImageUsageJsx(img: StockImageItem): string {
  if (img.type === 'background') {
    return `<section className="relative min-h-[60vh] bg-cover bg-center flex items-center justify-center text-center" style={{ backgroundImage: 'url(${img.url})' }}>
  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
  <div className="relative z-10 container mx-auto px-6 py-20">
    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight ${img.contrast === 'light-text' ? 'text-white' : 'text-gray-900'}">
      Your Inspiring Headline
    </h1>
    <p className="mt-4 text-lg md:text-xl text-gray-200 max-w-2xl mx-auto">
      Elevate your experience with modern solutions crafted for excellence.
    </p>
  </div>
</section>`;
  }

  return `<img
  src="${img.url}"
  alt="${img.alt}"
  className="w-full h-64 md:h-80 object-cover rounded-2xl shadow-md transition-transform duration-300 hover:scale-[1.02]"
  loading="lazy"
/>`;
}
