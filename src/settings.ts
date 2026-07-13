export interface WeightedRelationshipGraphSettings {
  minimumWeight: number;
  layoutDurationMs: number;
  recencyEnabled: boolean;
  recencyHalfLifeDays: number;
  enabledRuleIds: string[];
  nodeSizeScale: number;
}

export const DEFAULT_SETTINGS: WeightedRelationshipGraphSettings = {
  minimumWeight: 1,
  layoutDurationMs: 5000,
  recencyEnabled: true,
  recencyHalfLifeDays: 90,
  enabledRuleIds: ["shared-context", "direct-link"],
  nodeSizeScale: 1,
};
