export type FeatureRecord = {
  id: string;
  title: string;
  path?: string;
  source: "core" | "route" | "custom";
};

export const MJIC_FEATURES: readonly FeatureRecord[] = [
  { id: "lalamove", title: "Lalamove Logistics", path: "/api/logistics", source: "core" },
  { id: "embroidery-digitizer", title: "Embroidery Digitizer", path: "/admin/digitizer", source: "core" },
  { id: "subcon-outreach", title: "Subcontractor Outreach", path: "/admin/subcons", source: "core" },
  { id: "download-html", title: "Download HTML", path: "/api/admin/export/html", source: "core" },
  { id: "ai-logo-creator", title: "AI Logo Creator", path: "/admin/logo-creator", source: "core" },
  { id: "mockup-video", title: "Mockup & Jacket Video Mockup", path: "/admin/video-mockups", source: "core" },
  { id: "quotations", title: "Formal, Price & Bulk Quotation", path: "/quote", source: "core" },
  { id: "choose-fabric", title: "Choose Fabric", path: "/quote", source: "core" },
  { id: "checkout-payment", title: "Checkout & Payment", path: "/quote", source: "core" },
  { id: "product-catalogue", title: "Product Catalogue", path: "/#catalogue", source: "core" },
  { id: "ceo-ai-studio", title: "CEO AI Studio & Enhancer", path: "/catalogue-enhancer", source: "core" },
  { id: "client-journey", title: "Client Journey Video", path: "/mjic-client-journey.html", source: "core" },
  { id: "production-update", title: "Production Update", path: "/api/updates", source: "core" },
  { id: "faq", title: "Frequently Asked Questions", path: "/#faq", source: "core" },
  { id: "contact", title: "Contact", path: "/#contact", source: "core" },
  { id: "sports-news-widgets", title: "Alex Eala, NBA & World News Widgets", path: "/", source: "core" },
  { id: "ai-swarm-employees", title: "AI Swarm & Employees", path: "/admin/command", source: "core" },
  { id: "ai-coo", title: "Super Intelligent AI COO", path: "/api/admin/coo", source: "core" },
  { id: "crm-erp", title: "CRM / ERP", path: "/admin", source: "core" },
  { id: "telegram-vercel-ai", title: "Telegram & Vercel AI", path: "/api/telegram-webhook", source: "core" },
  { id: "auto-social-ads-seo", title: "Auto Social Ads, Auto-Posting & SEO", path: "/api/cron/content-publisher", source: "core" },
  { id: "ui-ux", title: "Mobile-first UI / UX", path: "/", source: "core" },
  { id: "ai-website-editor", title: "AI Website Editor", path: "/admin/editor", source: "core" },
] as const;

export function routeFeatures(paths: readonly string[]): FeatureRecord[] {
  return paths.map((path) => ({
    id: `route-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "home"}`,
    title: path === "/" ? "Storefront page" : path.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ") || path,
    path,
    source: "route",
  }));
}

export function validCustomFeature(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 120;
}

export function normalizeCustomFeatures(value: unknown): FeatureRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): FeatureRecord[] => {
    if (typeof entry !== "string" || !validCustomFeature(entry)) return [];
    const title = entry.trim();
    const normalized = title.toLocaleLowerCase();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ id: `custom-${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, title, source: "custom" }];
  }).slice(0, 100);
}
