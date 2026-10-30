// Pure helpers for collapsing orders rows into one CRM client per real customer.

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Phone is the stable identity when present (matches existing csv_import contacts); otherwise the name.
export function clientKey(order) {
  const phone = normalizePhone(order.contact_phone);
  if (phone) return { key: phone, externalId: phone };
  const name = normalizeName(order.client_name);
  if (name) return { key: `name:${name}`, externalId: `name:${name}` };
  return null;
}

export function groupOrders(orders) {
  const groups = new Map();
  const skipped = [];
  for (const order of orders) {
    const identity = clientKey(order);
    if (!identity) {
      skipped.push(order.order_number);
      continue;
    }
    const group = groups.get(identity.key) || { externalId: identity.externalId, name: null, phone: null, orders: [] };
    group.orders.push(order);
    if (!group.name && order.client_name) group.name = order.client_name.trim();
    if (!group.phone && order.contact_phone) group.phone = order.contact_phone.trim();
    groups.set(identity.key, group);
  }
  return { groups: [...groups.values()], skipped };
}

const ACTIVE_EXCLUDED = new Set(['CANCELLED']);

export function toCrmRow(group, now) {
  const counted = group.orders.filter((order) => !ACTIVE_EXCLUDED.has(order.stage));
  const allCancelled = counted.length === 0;
  return {
    channel: 'csv_import',
    external_id: group.externalId,
    name: group.name,
    phone: group.phone,
    stage: allCancelled ? 'lost' : 'won',
    orders_count: counted.length,
    lifetime_value: counted.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    notes: `Synced from orders table (${group.orders.length} order row(s))`,
    updated_at: now,
  };
}
