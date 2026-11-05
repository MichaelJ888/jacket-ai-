export type GoalStep = { id: string; title: string; detail: string };

export type MainGoal = {
  id: string;
  number: number;
  title: string;
  summary: string;
  href?: string;
  steps: GoalStep[];
};

export type GoalStatus = 'not_started' | 'in_progress' | 'complete';

export const MAIN_GOALS: MainGoal[] = [
  {
    id: 'virtual-office',
    number: 1,
    title: 'Virtual Office',
    summary: 'A registered Philippine business address that government offices and PhilGEPS will accept.',
    steps: [
      { id: 'vo-compare', title: 'Choose a provider', detail: 'Compare virtual office providers that issue a Philippine business address with proof of address.' },
      { id: 'vo-signup', title: 'Subscribe and get proof of address', detail: 'Sign the contract and keep the proof-of-address document (contract or billing statement).' },
      { id: 'vo-records', title: 'Use the address on all registrations', detail: 'Use this exact address for DTI/SEC, BIR, the Mayor\'s permit, and PhilGEPS so the records match.' },
      { id: 'vo-mail', title: 'Set up mail handling', detail: 'Assign who collects mail and how scanned or forwarded mail reaches the CEO.' },
    ],
  },
  {
    id: 'business-permit',
    number: 2,
    title: 'Business Permit',
    summary: 'Legal registration: business name, BIR registration, then the LGU Mayor\'s permit.',
    steps: [
      { id: 'bp-name', title: 'Register the business name', detail: 'Register with DTI (sole proprietorship) or SEC (corporation or partnership).' },
      { id: 'bp-bir', title: 'Register with the BIR', detail: 'Obtain the TIN and certificate of registration, and authority to print official receipts (the website promises BIR-registered receipts).' },
      { id: 'bp-barangay', title: 'Get barangay clearance', detail: 'Obtain barangay clearance for the business address from the Virtual Office step.' },
      { id: 'bp-permit', title: 'Apply for the Mayor\'s permit', detail: 'File with the LGU using the DTI/SEC papers, BIR certificate, address proof, and barangay clearance, then pay the fees. Check the current LGU checklist first.' },
      { id: 'bp-renewal', title: 'Calendar the renewal', detail: 'Post or keep the permit on file as the LGU requires and set a renewal reminder.' },
    ],
  },
  {
    id: 'philgeps',
    number: 3,
    title: 'PhilGEPS',
    summary: 'Government supplier registration, needed for public bidding.',
    steps: [
      { id: 'pg-docs', title: 'Gather the required documents', detail: 'Prepare the documents PhilGEPS currently requires (typically DTI/SEC papers, Mayor\'s permit, BIR registration, and tax returns). Confirm the list on the PhilGEPS site.' },
      { id: 'pg-account', title: 'Create the supplier account', detail: 'Register at philgeps.gov.ph as a supplier.' },
      { id: 'pg-platinum', title: 'Apply for Platinum membership', detail: 'Submit the membership application with the documents. Full bidding needs Platinum status.' },
      { id: 'pg-verified', title: 'Wait for verification', detail: 'Respond to any PhilGEPS queries until the registration is approved.' },
      { id: 'pg-record', title: 'Record the number and expiry', detail: 'Store the PhilGEPS registration number and expiry date, and set a renewal reminder.' },
      { id: 'pg-claim', title: 'Verify the website claim', detail: 'Confirm the site\'s "PhilGEPS-compliant" wording matches the approved registration before showing it to clients.' },
    ],
  },
  {
    id: 'school-uniforms',
    number: 4,
    title: 'School Uniforms (OLOPSCH & FEU)',
    summary: 'School uniform orders for Our Lady of Perpetual Help School (OLOPSCH) and FEU.',
    href: '/quote',
    steps: [
      { id: 'su-specs', title: 'Get the official specs and sample', detail: 'Obtain the uniform specifications and an approved sample from each school.' },
      { id: 'su-requirements', title: 'Confirm supplier requirements and deadlines', detail: 'Check each school\'s supplier requirements, quantities, and delivery dates.' },
      { id: 'su-quote', title: 'Issue the quotation', detail: 'Create the quote on /quote from the official pricelist tiers. Do not invent prices.' },
      { id: 'su-approval', title: 'Get the sample approved', detail: 'Get the school\'s written approval of the sample and proof before production.' },
      { id: 'su-deliver', title: 'Produce, inspect, and deliver', detail: 'Produce, run quality control, deliver, and issue the official receipt.' },
    ],
  },
  {
    id: 'company-giveaways',
    number: 5,
    title: 'Company Giveaways',
    summary: 'Promotional items priced by market rate (median x 1.20, server-side).',
    href: '/quote',
    steps: [
      { id: 'cg-logo', title: 'Collect the logo and quantity', detail: 'Get the client\'s logo in vector or high-resolution form, plus the item type and quantity.' },
      { id: 'cg-price', title: 'Price the giveaway', detail: 'Generate the giveaway quote on /quote. It uses the market median x 1.20 and is calculated server-side.' },
      { id: 'cg-approve', title: 'Get the quote and proof approved', detail: 'Send the quote, then get the client\'s written approval of the proof.' },
      { id: 'cg-deliver', title: 'Produce and deliver', detail: 'Produce, check quality, deliver, and record the order.' },
    ],
  },
  {
    id: 'company-uniforms',
    number: 6,
    title: 'Company Uniforms',
    summary: 'Corporate uniforms from the official pricelist, with the fabric class rule applied.',
    href: '/admin/pricelist',
    steps: [
      { id: 'cu-matrix', title: 'Enter the official price matrix', detail: 'Enter each uniform matrix in /admin/pricelist. Until it is entered, the quote is a sales confirmation.' },
      { id: 'cu-fabric', title: 'Confirm fabric and class', detail: 'Confirm the fabric. Only Microfiber, Michael Angelo, and Diamond Ripstop are Class B; all other fabrics are Class A.' },
      { id: 'cu-quote', title: 'Issue the formal quotation', detail: 'Create the quotation on /quote (MJIC-YYYY-NNNN) using the official tiers.' },
      { id: 'cu-sample', title: 'Approve the sample and sizes', detail: 'Get the sample approved and confirm the size run in writing.' },
      { id: 'cu-deliver', title: 'Produce and deliver', detail: 'Produce, check quality, deliver, and issue the official receipt.' },
    ],
  },
];

export const ALL_STEP_IDS: ReadonlySet<string> = new Set(MAIN_GOALS.flatMap((goal) => goal.steps.map((step) => step.id)));

// Keeps only known step IDs, dropping anything unrecognised and duplicates.
export function parseDoneSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && ALL_STEP_IDS.has(item)) seen.add(item);
  }
  return [...seen];
}

// Returns the new done list, or null when the step ID is unknown.
export function setStepDone(doneSteps: readonly string[], stepId: string, done: boolean): string[] | null {
  if (!ALL_STEP_IDS.has(stepId)) return null;
  const next = new Set(doneSteps);
  if (done) next.add(stepId);
  else next.delete(stepId);
  return [...next];
}

export function goalProgress(goal: MainGoal, doneSteps: readonly string[]) {
  const done = goal.steps.filter((step) => doneSteps.includes(step.id)).length;
  const total = goal.steps.length;
  const status: GoalStatus = done === 0 ? 'not_started' : done === total ? 'complete' : 'in_progress';
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), status };
}

export function overallProgress(doneSteps: readonly string[]) {
  const total = MAIN_GOALS.reduce((sum, goal) => sum + goal.steps.length, 0);
  const done = MAIN_GOALS.reduce((sum, goal) => sum + goal.steps.filter((step) => doneSteps.includes(step.id)).length, 0);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
