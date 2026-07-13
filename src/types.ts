export interface GraphEntityNode {
  id: string;
  label: string;
  filePath: string;
  folder: string;
  tags: string[];
  projects: string[];
  modifiedTime: number;
}

export interface RelationshipEvidence {
  sourceNotePath: string;
  sourceNoteName: string;
  ruleId: string;
  ruleLabel: string;
  baseWeight: number;
  weightedValue: number;
  timestamp: number;
  projects: string[];
}

export interface Relationship {
  id: string;
  source: string;
  target: string;
  weight: number;
  rawWeight: number;
  weightByRule: Record<string, number>;
  evidence: RelationshipEvidence[];
  mostRecentTimestamp: number;
  projects: string[];
}

export interface RelationshipGraphData {
  nodes: GraphEntityNode[];
  relationships: Relationship[];
}

export interface GraphFilters {
  minimumWeight: number;
  searchQuery: string;
  folder: string;
  ruleId: string;
  project: string;
  recentDays: number;
}

export interface FilterOptions {
  folders: string[];
  ruleIds: Array<{ id: string; label: string }>;
  projects: string[];
}

export interface ScanDiagnostics {
  scannedFiles: number;
  contributingNotes: number;
  unresolvedLinks: string[];
  nonContributingNotes: string[];
}

export interface ScanResult {
  graph: RelationshipGraphData;
  diagnostics: ScanDiagnostics;
  filterOptions: FilterOptions;
}
