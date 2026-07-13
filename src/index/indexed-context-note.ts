import type { GraphEntityNode } from "../types";
import type { RelationshipContribution } from "../rules/relationship-rule";

export interface IndexedContextNote {
  sourceNotePath: string;
  sourceNoteName: string;
  sourceNode: GraphEntityNode;
  referencedNodes: GraphEntityNode[];
  contributions: RelationshipContribution[];
}
