import {
  normalizePair,
  type ParsedSourceNote,
  type RelationshipContribution,
  type RelationshipRule,
} from "./relationship-rule";

export class SharedContextRule implements RelationshipRule {
  readonly id = "shared-context";
  readonly label = "Shared context";

  calculate(note: ParsedSourceNote): RelationshipContribution[] {
    const contributions: RelationshipContribution[] = [];
    const nodes = note.referencedNodes;

    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex++) {
        const first = nodes[firstIndex];
        const second = nodes[secondIndex];
        if (!first || !second) continue;

        const [source, target] = normalizePair(first.id, second.id);
        contributions.push({
          source,
          target,
          weight: 1,
          ruleId: this.id,
          ruleLabel: this.label,
          evidencePath: note.sourceNotePath,
          evidenceName: note.sourceNoteName,
          timestamp: note.timestamp,
          projects: note.projects,
        });
      }
    }

    return contributions;
  }
}
