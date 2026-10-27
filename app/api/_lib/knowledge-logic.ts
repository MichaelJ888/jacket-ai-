const CUSTOMER_SAFE_CATEGORIES = new Set(['faq', 'tone', 'product', 'size_chart']);

export type KnowledgeFact = { category: string; title: string; content: string };

export function serializeCustomerKnowledge(items: KnowledgeFact[], maxLength = 7000) {
  const safe = items
    .filter((item) => CUSTOMER_SAFE_CATEGORIES.has(item.category))
    .map((item) => ({
      category: item.category,
      title: item.title.replace(/\u0000/g, '').slice(0, 120),
      content: item.content.replace(/\u0000/g, '').slice(0, 1200),
    }));

  let serialized = JSON.stringify(safe);
  while (serialized.length > maxLength && safe.length) {
    safe.pop();
    serialized = JSON.stringify(safe);
  }
  return safe.length ? serialized : '';
}
