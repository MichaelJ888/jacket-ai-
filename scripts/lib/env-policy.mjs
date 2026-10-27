export const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'GEMINI_API_KEY', 'AI_GATEWAY_API_KEY',
  'CRON_SECRET', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN', 'MEMORY_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET', 'PAYMENT_WEBHOOK_SECRET', 'MANYCHAT_WEBHOOK_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET', 'META_APP_ID',
];

export const META_ENV = ['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN'];
export const PRODUCTION_SYNC_KEYS = [...REQUIRED_ENV, ...META_ENV, 'APP_BASE_URL'];
export const TARGETS = ['production', 'preview', 'development'];

export function auditEnvironment(local, envs) {
  const keys = [...REQUIRED_ENV, ...META_ENV];
  const sharedUrl = envs.find((entry) => entry.key === 'NEXT_PUBLIC_SUPABASE_URL' && !entry.gitBranch &&
    [].concat(entry.target || []).includes('production') &&
    [].concat(entry.target || []).some((target) => target === 'preview' || target === 'development'));
  return {
    local: { missing: keys.filter((key) => !local[key]?.trim()) },
    databaseIsolation: sharedUrl ? {
      status: 'shared',
      targets: [].concat(sharedUrl.target).filter((target) => TARGETS.includes(target)),
      detail: 'These targets share one Supabase URL setting. Do not enable nonproduction writes against production data.',
    } : {
      status: 'unverified', targets: [],
      detail: 'Separate metadata entries do not prove separate databases; verify project identity before enabling writes.',
    },
    targets: Object.fromEntries(TARGETS.map((target) => {
      const entries = envs.filter((entry) => [].concat(entry.target || []).includes(target) && !entry.gitBranch);
      const present = new Set(entries.map((entry) => entry.key));
      return [target, {
        count: present.size,
        missing: keys.filter((key) => !present.has(key)),
        valueValidation: 'metadata-only; secret equality, expiry and environment isolation are not verified',
      }];
    })),
  };
}

export function planProductionSync(local, envs) {
  const missing = new Set(auditEnvironment(local, envs).targets.production.missing);
  const present = envs.some((entry) => entry.key === 'APP_BASE_URL' && [].concat(entry.target || []).includes('production') && !entry.gitBranch);
  if (!present) missing.add('APP_BASE_URL');
  return PRODUCTION_SYNC_KEYS.filter((key) => missing.has(key) && local[key]?.trim())
    .map((key) => ({ key, value: local[key], type: 'encrypted', target: ['production'] }));
}
