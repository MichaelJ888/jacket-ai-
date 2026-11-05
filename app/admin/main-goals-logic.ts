export type GoalStep = { id: string; title: string; done: boolean };
export type MainGoal = { id: string; title: string; steps: GoalStep[] };
export type GoalStatus = 'not_started' | 'in_progress' | 'complete';

export const MAX_GOALS = 20;
export const MAX_STEPS_PER_GOAL = 30;
export const MAX_TITLE_LENGTH = 160;

const SEED: ReadonlyArray<{ id: string; title: string; steps: readonly string[] }> = [
  {
    id: 'virtual-office',
    title: 'Virtual Office',
    steps: [
      'Research registered providers in key business districts (QC/Makati/BGC)',
      'Verify mail handling, call forwarding, and physical inspection options',
      'Prepare company registration documents and sign lease agreement',
      'Update BIR and LGU records with new Virtual Office address',
    ],
  },
  {
    id: 'business-permit',
    title: 'Business Permit',
    steps: [
      'Secure Barangay Clearance for official operating site',
      'Complete Zoning, Fire, and Sanitary Inspection clearances',
      "Submit requirements to LGU/Mayor's Permit office",
      'Pay LGU taxes/fees and collect official Business Permit plate',
    ],
  },
  {
    id: 'philgeps',
    title: 'PhilGEPS',
    steps: [
      'Register/Login to PhilGEPS Platinum portal',
      "Upload active Mayor's Permit, Tax Clearance, SEC/DTI, and Audited Financial Statements",
      'Complete membership fee payment for Platinum Certificate',
      'Enable automated bid notification alerts for school & government apparel tenders',
    ],
  },
  {
    id: 'school-uniforms',
    title: 'School Uniforms (OLOPSCH & FEU)',
    steps: [
      'Finalize fabric sourcing and exact color-match swatches for OLOPSCH & FEU',
      'Produce high-quality pre-production samples (Polo Shirt / PE / Corporate attire)',
      'Present prototype samples and official pricelist proposal to administration',
      'Secure bulk procurement contract and schedule production batching',
    ],
  },
  {
    id: 'company-giveaways',
    title: 'Company Giveaways',
    steps: [
      'Verify Gemini Search Grounding dynamic price engine (`Median × 1.20`)',
      'Expand catalog options (custom umbrellas, tumblers, pouches, eco-bags)',
      'Prepare downloadable PDF corporate giveaway catalog for clients',
      'Launch targeted digital marketing ads for corporate year-end orders',
    ],
  },
  {
    id: 'company-uniforms',
    title: 'Company Uniforms',
    steps: [
      'Standardize 20 pcs MOQ pricing structure sa `mjic-pricelist.ts`',
      'Set up digital sample catalog for corporate clients',
      'Integrate direct Viber/Telegram quick-quote CTA buttons',
      'Automate follow-ups for corporate HR & procurement leads',
    ],
  },
];

function newId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

// Collapses whitespace and trims. Used for server input and for new titles, not for keystroke edits.
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function defaultGoals(): MainGoal[] {
  return SEED.map((goal) => ({
    id: goal.id,
    title: goal.title,
    steps: goal.steps.map((title, index) => ({ id: `${goal.id}-${index + 1}`, title, done: false })),
  }));
}

function uniqueId(value: unknown, used: Set<string>, prefix: string) {
  let id = cleanText(value, 64);
  if (!id || used.has(id)) id = newId(prefix);
  used.add(id);
  return id;
}

// Validates stored or submitted goals. Returns null when the input is not a list. Drops blank titles, and caps counts.
export function parseGoals(value: unknown): MainGoal[] | null {
  if (!Array.isArray(value)) return null;
  const goalIds = new Set<string>();
  const goals: MainGoal[] = [];
  for (const rawGoal of value.slice(0, MAX_GOALS)) {
    if (!rawGoal || typeof rawGoal !== 'object') continue;
    const goal = rawGoal as Record<string, unknown>;
    const title = cleanText(goal.title, MAX_TITLE_LENGTH);
    if (!title) continue;
    const stepIds = new Set<string>();
    const rawSteps = Array.isArray(goal.steps) ? goal.steps.slice(0, MAX_STEPS_PER_GOAL) : [];
    const steps: GoalStep[] = [];
    for (const rawStep of rawSteps) {
      if (!rawStep || typeof rawStep !== 'object') continue;
      const step = rawStep as Record<string, unknown>;
      const stepTitle = cleanText(step.title, MAX_TITLE_LENGTH);
      if (!stepTitle) continue;
      steps.push({ id: uniqueId(step.id, stepIds, 'step'), title: stepTitle, done: step.done === true });
    }
    goals.push({ id: uniqueId(goal.id, goalIds, 'goal'), title, steps });
  }
  return goals;
}

export function toggleStep(goals: readonly MainGoal[], stepId: string, done: boolean): MainGoal[] {
  return goals.map((goal) => ({
    ...goal,
    steps: goal.steps.map((step) => (step.id === stepId ? { ...step, done } : step)),
  }));
}

// Stores the raw text so the CEO can type spaces. The server trims on save.
export function setStepTitle(goals: readonly MainGoal[], stepId: string, title: string): MainGoal[] {
  const value = title.slice(0, MAX_TITLE_LENGTH);
  return goals.map((goal) => ({
    ...goal,
    steps: goal.steps.map((step) => (step.id === stepId ? { ...step, title: value } : step)),
  }));
}

export function addStep(goals: readonly MainGoal[], goalId: string, title: string): MainGoal[] {
  const clean = cleanText(title, MAX_TITLE_LENGTH);
  if (!clean) return [...goals];
  return goals.map((goal) =>
    goal.id === goalId && goal.steps.length < MAX_STEPS_PER_GOAL
      ? { ...goal, steps: [...goal.steps, { id: newId('step'), title: clean, done: false }] }
      : goal,
  );
}

export function deleteStep(goals: readonly MainGoal[], stepId: string): MainGoal[] {
  return goals.map((goal) => ({ ...goal, steps: goal.steps.filter((step) => step.id !== stepId) }));
}

export function addGoal(goals: readonly MainGoal[], title: string, stepTitles: readonly string[]): MainGoal[] {
  const clean = cleanText(title, MAX_TITLE_LENGTH);
  if (!clean || goals.length >= MAX_GOALS) return [...goals];
  const steps = stepTitles
    .map((step) => cleanText(step, MAX_TITLE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_STEPS_PER_GOAL)
    .map((step) => ({ id: newId('step'), title: step, done: false }));
  return [...goals, { id: newId('goal'), title: clean, steps }];
}

export function deleteGoal(goals: readonly MainGoal[], goalId: string): MainGoal[] {
  return goals.filter((goal) => goal.id !== goalId);
}

export function goalProgress(goal: MainGoal) {
  const done = goal.steps.filter((step) => step.done).length;
  const total = goal.steps.length;
  const status: GoalStatus = done === 0 ? 'not_started' : done === total ? 'complete' : 'in_progress';
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), status };
}

export function overallProgress(goals: readonly MainGoal[]) {
  const total = goals.reduce((sum, goal) => sum + goal.steps.length, 0);
  const done = goals.reduce((sum, goal) => sum + goal.steps.filter((step) => step.done).length, 0);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// Reads the model's answer as a JSON array of strings, falling back to one step per line. Returns at most 5 unique steps.
export function parseSuggestedSteps(text: string): string[] {
  let items: unknown[] = [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }
  if (items.length === 0) {
    items = text.split('\n').map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''));
  }
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const item of items) {
    const step = cleanText(item, MAX_TITLE_LENGTH);
    const key = step.toLowerCase();
    if (!step || seen.has(key)) continue;
    seen.add(key);
    steps.push(step);
    if (steps.length === 5) break;
  }
  return steps;
}
