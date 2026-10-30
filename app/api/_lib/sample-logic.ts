export const SAMPLE_STATUSES = ['OUT', 'RETURNED', 'LOST', 'DAMAGED'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export type SampleRow = {
  id: string;
  item: string;
  client_name: string;
  status: string;
  expected_return_at: string | null;
  returned_at: string | null;
};

// An OUT sample is overdue once its expected return date (YYYY-MM-DD) is before today (Manila date).
export function isSampleOverdue(sample: Pick<SampleRow, 'status' | 'expected_return_at'>, today: string) {
  return sample.status === 'OUT' && !!sample.expected_return_at && sample.expected_return_at < today;
}

export function summarizeSamples(samples: SampleRow[], today: string) {
  const out = samples.filter((sample) => sample.status === 'OUT');
  return {
    outCount: out.length,
    overdueCount: out.filter((sample) => isSampleOverdue(sample, today)).length,
    returnedCount: samples.filter((sample) => sample.status === 'RETURNED').length,
    lostOrDamagedCount: samples.filter((sample) => sample.status === 'LOST' || sample.status === 'DAMAGED').length,
  };
}
