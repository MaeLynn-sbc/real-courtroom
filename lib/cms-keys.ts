// Fixed Setting keys the website CMS reads/writes (see
// services/settings/settings.service.ts's CMS methods). One key per
// content section — each row's value is a structured JSON object/array,
// not a string or boolean.
export const CMS_KEYS = {
  HOMEPAGE_HERO: "cms.homepage.hero",
  BUSINESS_INFO: "cms.business.info",
  OTHER_RATES: "cms.rates.other",
  GALLERY_IMAGES: "cms.gallery.images",
  COURT_HOURS: "cms.courtHours",
  OPEN_PLAY_SETTINGS: "cms.openPlaySettings",
} as const;
