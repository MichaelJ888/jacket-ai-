// Pure mapping from Meta lead-ad rows to CRM contact input. No I/O, so it stays unit-testable.

export function leadgenExternalId(leadgenId: string) {
  return `leadgen:${leadgenId}`;
}

export function isMjicLeadgenPage(pageId: string | undefined, mjicPageId: string | undefined): pageId is string {
  return Boolean(pageId && mjicPageId && pageId === mjicPageId);
}

type LeadRow = {
  name?: string | null;
  contact?: string | null;
  source?: string | null;
  details?: Record<string, unknown> | null;
};

export function leadgenContactInput(row: LeadRow) {
  const details = row.details || {};
  const leadgenId = typeof details.leadgenId === 'string' ? details.leadgenId : '';
  if (!leadgenId) return null;

  const rawContact = (row.contact || '').trim();
  const email = (typeof details.email === 'string' && details.email) || (rawContact.includes('@') ? rawContact : '');
  const phone = (typeof details.phone === 'string' && details.phone) || (rawContact && !rawContact.includes('@') ? rawContact : '');
  const pageId = typeof details.pageId === 'string' && details.pageId ? details.pageId : undefined;
  const name = row.name && row.name !== 'Facebook lead' ? row.name : undefined;

  return {
    channel: 'facebook' as const,
    externalId: leadgenExternalId(leadgenId),
    name,
    phone: phone || undefined,
    email: email || undefined,
    pageId,
  };
}
