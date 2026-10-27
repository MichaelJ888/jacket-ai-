export function parseWorkerOptions(args) {
  const taskFlag = args.indexOf('--task');
  const taskId = taskFlag < 0 ? null : args[taskFlag + 1];
  if (taskFlag >= 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId || '')) {
    throw new Error('--task requires a full dev_tasks UUID.');
  }
  const once = args.includes('--once');
  const deferCompletion = args.includes('--defer-completion');
  if (deferCompletion && (!once || !taskId)) throw new Error('--defer-completion requires --once and --task.');
  return { once, taskId, deferCompletion };
}

export function classifyWorkerResult({ code, out, err }) {
  if (/no authentication information|not logged in|login/i.test(err) && !out) return 'auth';
  return code === 0 && !/^NEEDS INPUT:/m.test(out) ? 'success' : 'failed';
}

export function workerExitCode(outcome, targeted) {
  if (outcome === 'auth') return 2;
  if (outcome === 'failed') return 1;
  if (outcome === 'idle' && targeted) return 3;
  return 0;
}
