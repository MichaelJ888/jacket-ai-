// Corporate org chart (Board -> CEO -> C-Suite -> VPs -> Regional) wired to the
// job-heartbeat state machine: each seat's status rolls up from the AI jobs that
// power it, so the org chart doubles as a live system-status map.
import data from './org-structure.json' with { type: 'json' };
import type { JobState } from './coo-logic';

export type OrgDepartment = { id: string; name: string; roles: string[]; href: string };
export type OrgNode = {
  id: string;
  title: string;
  department: string;
  reportsTo: string | null;
  region?: 'AMER' | 'EMEA' | 'APAC';
  aiJobs: string[];
};

export const ORG = data as { version: number; company: string; departments: OrgDepartment[]; nodes: OrgNode[] };

export type SeatStatus = 'operational' | 'attention' | 'manual';

// Worst-of rollup: any stale/degraded backing job puts the seat in attention.
// Seats with no AI backing are human chairs -> 'manual' (not a failure).
export function seatStatus(node: OrgNode, states: ReadonlyMap<string, JobState>): SeatStatus {
  if (!node.aiJobs.length) return 'manual';
  for (const job of node.aiJobs) {
    const state = states.get(job);
    if (state === 'stale' || state === 'degraded') return 'attention';
  }
  return 'operational';
}

export function orgWithStatus(states: ReadonlyMap<string, JobState>) {
  return {
    company: ORG.company,
    departments: ORG.departments,
    nodes: ORG.nodes.map((node) => ({ ...node, status: seatStatus(node, states) })),
  };
}
