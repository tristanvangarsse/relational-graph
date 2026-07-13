import {
  normalizePair,
  type ParsedSourceNote,
  type RelationshipContribution,
  type RelationshipRule,
} from "./relationship-rule";

export class DirectLinkRule implements RelationshipRule {
  readonly id = "direct-link";
  readonly label = "Direct link";

  calculate(note: ParsedSourceNote): RelationshipContribution[] {
    return note.referencedNodes
      .filter((targetNode) => targetNode.id !== note.sourceNode.id)
      .map((targetNode) => {
        const [source, target] = normalizePair(note.sourceNode.id, targetNode.id);
        return {
          source,
          target,
          weight: 1,
          ruleId: this.id,
          ruleLabel: this.label,
          evidencePath: note.sourceNotePath,
          evidenceName: note.sourceNoteName,
          timestamp: note.timestamp,
          projects: note.projects,
        };
      });
  }
}
