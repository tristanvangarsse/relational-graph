import type { GraphEntityNode } from "../types";

export interface ParsedSourceNote {
  sourceNotePath: string;
  sourceNoteName: string;
  sourceNode: GraphEntityNode;
  referencedNodes: GraphEntityNode[];
  timestamp: number;
  projects: string[];
}

export interface RelationshipContribution {
  source: string;
  target: string;
  weight: number;
  ruleId: string;
  ruleLabel: string;
  evidencePath: string;
  evidenceName: string;
  timestamp: number;
  projects: string[];
}

export interface RelationshipRule {
  readonly id: string;
  readonly label: string;
  calculate(note: ParsedSourceNote): RelationshipContribution[];
}

export function normalizePair(first: string, second: string): [string, string] {
  return first.localeCompare(second) <= 0
    ? [first, second]
    : [second, first];
}
