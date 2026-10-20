const GRAPH = 'https://graph.facebook.com/v21.0';

export type MetaPage = { id: string; name: string; token: string };

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; pages: MetaPage[] } | null = null;

function parseTokenMap(): Record<string, string> {
  const raw = process.env.META_PAGE_TOKENS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string' && value)) as Record<string, string>;
  } catch {
    return {};
  }
}

// One long-lived System User token (Business Manager) lists every Page it owns together with each Page's own token,
// so adding a new MJIC Page only needs the Page assigned to the System User - no new env var or redeploy.
export async function discoverPages(force = false): Promise<MetaPage[]> {
  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!systemToken) return [];
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.pages;

  const pages: MetaPage[] = [];
  let url: string | null = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100`;
  for (let guard = 0; url && guard < 10; guard += 1) {
    try {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${systemToken}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) break;
      const data = (await response.json()) as { data?: Array<{ id: string; name: string; access_token?: string }>; paging?: { next?: string } };
      for (const page of data.data || []) if (page.access_token) pages.push({ id: page.id, name: page.name, token: page.access_token });
      url = data.paging?.next || null;
    } catch {
      break;
    }
  }
  if (pages.length) cache = { at: Date.now(), pages };
  return pages.length ? pages : cache?.pages || [];
}

// Resolution order: explicit META_PAGE_TOKENS map -> auto-discovered Page -> legacy single META_PAGE_ACCESS_TOKEN.
export async function getPageToken(pageId?: string): Promise<string | undefined> {
  if (pageId) {
    const mapped = parseTokenMap()[pageId];
    if (mapped) return mapped;
    const found = (await discoverPages()).find((page) => page.id === pageId);
    if (found) return found.token;
  }
  return process.env.META_PAGE_ACCESS_TOKEN;
}

export async function getDiscoveredPageName(pageId?: string): Promise<string | undefined> {
  if (!pageId) return undefined;
  return (await discoverPages()).find((page) => page.id === pageId)?.name;
}
