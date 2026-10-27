// Only optional inspection endpoints may downgrade access errors, never project/env/runtime calls.
export function accessSeverity(service, path, status) {
  if (status >= 200 && status < 300) return 'ok';
  if (service === 'vercel' && ['/v2/user', '/v2/teams'].includes(path) && [403, 404].includes(status)) return 'warning';
  if (service === 'github' && /^\/repos\/[^/]+\/[^/]+\/actions\/jobs\/\d+\/logs$/.test(path) && status === 401) return 'warning';
  return 'error';
}
