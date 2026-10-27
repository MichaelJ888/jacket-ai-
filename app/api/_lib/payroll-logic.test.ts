import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeSubconPayout, latestClosedSemiMonthly, latestSaturdayWeek, parseAttendanceText, periodInstants, isSaturday, type PayPeriod } from './payroll-logic.ts';

test('semi-monthly periods close on the 15th and month end', () => {
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 10, day: 16 }).label, '2026-10-01 to 2026-10-15');
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 11, day: 1 }).label, '2026-10-16 to 2026-10-31');
  assert.equal(latestClosedSemiMonthly({ year: 2027, month: 1, day: 1 }).label, '2026-12-16 to 2026-12-31');
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 3, day: 1 }).label, '2026-02-16 to 2026-02-28');
});

test('sewer week is Sunday-Saturday ending on the latest Saturday', () => {
  assert.ok(isSaturday({ year: 2026, month: 10, day: 10 }));
  assert.equal(latestSaturdayWeek({ year: 2026, month: 10, day: 10 }).label, 'Week 2026-10-04 to 2026-10-10');
  assert.equal(latestSaturdayWeek({ year: 2026, month: 10, day: 12 }).label, 'Week 2026-10-04 to 2026-10-10');
  assert.deepEqual(periodInstants({ start: '2026-10-04', end: '2026-10-10', label: '' }), { from: '2026-10-04T00:00:00+08:00', to: '2026-10-11T00:00:00+08:00' });
});

const subconPeriod: PayPeriod = { start: '2026-10-27', end: '2026-10-27', label: 'Project ORDER-42 - 2026-10-27' };
const subconLine = { name: 'Sewer One', total: 2500, note: 'ORDER-42' };
const subconRun = { id: 'run-1', kind: 'subcon', subject_key: 'job-1', period_start: '2026-10-27', period_end: '2026-10-27' };

function payoutDependencies(overrides: Partial<Parameters<typeof finalizeSubconPayout>[1]> = {}) {
  const events: string[] = [];
  let completedAt: string | null = null;
  let existingRun: typeof subconRun | null = null;
  let savedRuns = 0;
  let saveCalls = 0;
  const savedPeriods: PayPeriod[] = [];
  let closeError: string | null = null;
  let saveError: string | null = null;
  const dependencies: Parameters<typeof finalizeSubconPayout>[1] = {
    reserveCompletionAt: async () => {
      events.push('reserve');
      completedAt ||= '2026-10-27T18:00:00+08:00';
      return { value: completedAt };
    },
    findExistingRun: async () => {
      events.push('find');
      return { run: existingRun };
    },
    periodForCompletion: (completionAt) => {
      const dateText = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(completionAt));
      return { start: dateText, end: dateText, label: `Project ORDER-42 - ${dateText}` };
    },
    saveRun: async (period) => {
      events.push('save');
      saveCalls += 1;
      savedPeriods.push(period);
      if (saveError) return { created: false, error: saveError };
      if (existingRun) return { created: false, runId: existingRun.id };
      savedRuns += 1;
      existingRun = subconRun;
      return { created: true, runId: subconRun.id, total: subconLine.total };
    },
    closeJob: async () => {
      events.push('close');
      return { error: closeError };
    },
    ...overrides,
  };
  return {
    dependencies,
    events,
    setCompletedAt(value: string) { completedAt = value; },
    getCompletedAt() { return completedAt; },
    setExistingRun(value: typeof subconRun | null) { existingRun = value; },
    setCloseError(value: string | null) { closeError = value; },
    setSaveError(value: string | null) { saveError = value; },
    getSavedRuns() { return savedRuns; },
    getSaveCalls() { return saveCalls; },
    getSavedPeriods() { return savedPeriods; },
  };
}

test('subcontractor save failure leaves the job open', async () => {
  const mock = payoutDependencies();
  mock.setSaveError('database unavailable');
  const result = await finalizeSubconPayout({ jobId: 'job-1', completionAt: null, line: subconLine }, mock.dependencies);

  assert.match(result.error || '', /database unavailable/);
  assert.deepEqual(mock.events, ['reserve', 'find', 'save']);
  assert.equal(mock.getSavedRuns(), 0);
});

test('close failure retry reuses reserved completion date across days and creates one run', async () => {
  const mock = payoutDependencies();
  mock.setCloseError('temporary close failure');
  const first = await finalizeSubconPayout({ jobId: 'job-1', completionAt: null, line: subconLine }, mock.dependencies);
  assert.match(first.error || '', /could not be marked done/);
  assert.equal(mock.getCompletedAt(), '2026-10-27T18:00:00+08:00');
  mock.setCloseError(null);
  const retry = await finalizeSubconPayout({ jobId: 'job-1', completionAt: mock.getCompletedAt(), line: subconLine }, mock.dependencies);

  assert.equal(retry.runId, subconRun.id);
  assert.equal(mock.getSavedRuns(), 1);
  assert.deepEqual(mock.getSavedPeriods(), [subconPeriod]);
  assert.deepEqual(mock.events, ['reserve', 'find', 'save', 'close', 'find', 'close']);
});

test('legacy payroll run for the job is reused regardless of its prior period', async () => {
  const mock = payoutDependencies();
  mock.setExistingRun({ ...subconRun, period_start: '2026-10-26', period_end: '2026-10-26' });
  const result = await finalizeSubconPayout({ jobId: 'job-1', completionAt: '2026-10-27T18:00:00+08:00', line: subconLine }, mock.dependencies);

  assert.equal(result.runId, subconRun.id);
  assert.equal(mock.getSavedRuns(), 0);
  assert.deepEqual(mock.events, ['find', 'close']);
});

test('a save conflict without a confirmed matching run does not close the job', async () => {
  const mock = payoutDependencies({
    saveRun: async () => ({ created: false, error: 'unique conflict could not be matched to the intended run' }),
  });
  const result = await finalizeSubconPayout({ jobId: 'job-1', completionAt: '2026-10-27T18:00:00+08:00', line: subconLine }, mock.dependencies);

  assert.match(result.error || '', /could not be matched/);
  assert.deepEqual(mock.events, ['find']);
});

test('concurrent payout attempts share the atomically reserved completion date', async () => {
  let sharedCompletionAt: string | null = null;
  let runCreated = false;
  const savedPeriods: PayPeriod[] = [];
  const mock = payoutDependencies({
    reserveCompletionAt: async () => {
      mock.events.push('reserve');
      sharedCompletionAt ||= '2026-10-27T18:00:00+08:00';
      return { value: sharedCompletionAt };
    },
    saveRun: async (period) => {
      savedPeriods.push(period);
      if (runCreated) return { created: false, runId: subconRun.id };
      runCreated = true;
      return { created: true, runId: subconRun.id, total: subconLine.total };
    },
  });
  const args = { jobId: 'job-1', completionAt: null, line: subconLine };
  await Promise.all([
    finalizeSubconPayout(args, mock.dependencies),
    finalizeSubconPayout(args, mock.dependencies),
  ]);
  assert.equal(mock.events.filter((event) => event === 'reserve').length, 2);
  assert.equal(mock.events.filter((event) => event === 'close').length, 2);
  assert.deepEqual(savedPeriods, [subconPeriod, subconPeriod]);
});

test('attendance text parsing', () => {
  assert.equal(parseAttendanceText('Time in'), 'IN');
  assert.equal(parseAttendanceText('TIME-OUT 5pm'), 'OUT');
  assert.equal(parseAttendanceText('out'), 'OUT');
  assert.equal(parseAttendanceText('inventory check'), null);
  assert.equal(parseAttendanceText('hello'), null);
});
