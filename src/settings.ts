export interface WeightedRelationshipGraphSettings {
  minimumWeight: number;
  recencyEnabled: boolean;
  recencyHalfLifeDays: number;
  enabledRuleIds: string[];
  nodeSizeScale: number;
  minimumEdgeThickness: number;
  maximumEdgeThickness: number;
}
export const DEFAULT_SETTINGS: WeightedRelationshipGraphSettings = {
  minimumWeight: 1,
  recencyEnabled: true,
  recencyHalfLifeDays: 90,
  enabledRuleIds: ["shared-context", "direct-link"],
  nodeSizeScale: 1,
  minimumEdgeThickness: 0.75,
  maximumEdgeThickness: 6,
};