export type PublisherSummary = {
  failed: number;
  videoErrors: unknown[];
  needsCredentials: unknown[];
};

// Video-provider errors (e.g. AI Gateway billing) are reported in details but do not degrade the job,
// because they do not block publishing and would otherwise keep health permanently degraded.
export function publisherHeartbeatStatus(summary: PublisherSummary): 'ok' | 'degraded' {
  return summary.failed || summary.needsCredentials.length ? 'degraded' : 'ok';
}
