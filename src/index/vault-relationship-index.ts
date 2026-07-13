import { App, TFile } from "obsidian";
import { DirectLinkRule } from "../rules/direct-link-rule";
import { SharedContextRule } from "../rules/shared-context-rule";
import type {
  ParsedSourceNote,
  RelationshipContribution,
  RelationshipRule,
} from "../rules/relationship-rule";
import type { WeightedRelationshipGraphSettings } from "../settings";
import type {
  GraphEntityNode,
  GraphFilters,
  Relationship,
  RelationshipEvidence,
  ScanDiagnostics,
  ScanResult,
} from "../types";
import type { IndexedContextNote } from "./indexed-context-note";

interface CachedLink { link: string; }
interface ParsedContextNote {
  indexedNote: IndexedContextNote | null;
  unresolvedLinks: string[];
  containedLinks: boolean;
}
interface AggregateRelationship {
  id: string;
  source: string;
  target: string;
  contributions: RelationshipContribution[];
}

export class VaultRelationshipIndex {
  private readonly contextNotes = new Map<string, IndexedContextNote>();
  private readonly relationships = new Map<string, AggregateRelationship>();
  private readonly nodes = new Map<string, GraphEntityNode>();
  private readonly nodeReferenceCounts = new Map<string, number>();
  private readonly unresolvedLinksByFile = new Map<string, string[]>();
  private readonly nonContributingNotes = new Set<string>();
  private readonly rules: RelationshipRule[] = [
    new SharedContextRule(),
    new DirectLinkRule(),
  ];

  constructor(
    private readonly app: App,
    private readonly getSettings: () => WeightedRelationshipGraphSettings,
  ) {}

  rebuild(): void {
    this.contextNotes.clear();
    this.relationships.clear();
    this.nodes.clear();
    this.nodeReferenceCounts.clear();
    this.unresolvedLinksByFile.clear();
    this.nonContributingNotes.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.indexFile(file);
  }

  updateFile(file: TFile): void {
    if (file.extension !== "md") return;
    this.removeFile(file.path);
    this.indexFile(file);
  }

  removeFile(filePath: string): void {
    const previous = this.contextNotes.get(filePath);
    if (previous) {
      this.subtractContextNote(previous);
      this.contextNotes.delete(filePath);
    }
    this.unresolvedLinksByFile.delete(filePath);
    this.nonContributingNotes.delete(filePath);
  }

  getScanResult(filters: GraphFilters): ScanResult {
    const settings = this.getSettings();
    const now = Date.now();
    const enabledRules = new Set(settings.enabledRuleIds);
    const search = filters.searchQuery.trim().toLocaleLowerCase();
    const cutoff = filters.recentDays > 0
      ? now - filters.recentDays * 86_400_000
      : Number.NEGATIVE_INFINITY;

    const relationships: Relationship[] = [];
    for (const aggregate of this.relationships.values()) {
      const evidence: RelationshipEvidence[] = aggregate.contributions
        .filter((item) => enabledRules.has(item.ruleId))
        .filter((item) => filters.ruleId === "" || item.ruleId === filters.ruleId)
        .filter((item) => filters.project === "" || item.projects.includes(filters.project))
        .filter((item) => item.timestamp >= cutoff)
        .map((item) => ({
          sourceNotePath: item.evidencePath,
          sourceNoteName: item.evidenceName,
          ruleId: item.ruleId,
          ruleLabel: item.ruleLabel,
          baseWeight: item.weight,
          weightedValue: item.weight * this.recencyMultiplier(item.timestamp, now, settings),
          timestamp: item.timestamp,
          projects: item.projects,
        }));

      if (evidence.length === 0) continue;
      const sourceNode = this.nodes.get(aggregate.source);
      const targetNode = this.nodes.get(aggregate.target);
      if (!sourceNode || !targetNode) continue;
      if (filters.folder && sourceNode.folder !== filters.folder && targetNode.folder !== filters.folder) continue;
      if (search && !this.nodeMatches(sourceNode, search) && !this.nodeMatches(targetNode, search)) continue;

      const rawWeight = evidence.reduce(
        (sum, item) => sum + item.baseWeight,
        0,
      );

      if (rawWeight < filters.minimumWeight) continue;

      const weight = evidence.reduce(
        (sum, item) => sum + item.weightedValue,
        0,
      );
      const weightByRule: Record<string, number> = {};
      for (const item of evidence) weightByRule[item.ruleId] = (weightByRule[item.ruleId] ?? 0) + item.weightedValue;

      relationships.push({
        id: aggregate.id,
        source: aggregate.source,
        target: aggregate.target,
        weight,
        rawWeight,
        weightByRule,
        evidence,
        mostRecentTimestamp: Math.max(
          ...evidence.map((item) => item.timestamp),
        ),
        projects: Array.from(
          new Set(evidence.flatMap((item) => item.projects)),
        ).sort(),
      });
    }

    const visibleNodeIds = new Set<string>();
    for (const relationship of relationships) {
      visibleNodeIds.add(relationship.source);
      visibleNodeIds.add(relationship.target);
    }

    const nodes = Array.from(visibleNodeIds)
      .map((id) => this.nodes.get(id))
      .filter((node): node is GraphEntityNode => Boolean(node));

    const diagnostics: ScanDiagnostics = {
      scannedFiles: this.app.vault.getMarkdownFiles().length,
      contributingNotes: this.contextNotes.size,
      unresolvedLinks: Array.from(this.unresolvedLinksByFile.values()).flat(),
      nonContributingNotes: Array.from(this.nonContributingNotes),
    };

    return {
      graph: { nodes, relationships },
      diagnostics,
      filterOptions: {
        folders: Array.from(new Set(Array.from(this.nodes.values()).map((node) => node.folder).filter(Boolean))).sort(),
        ruleIds: this.rules.map((rule) => ({ id: rule.id, label: rule.label })),
        projects: Array.from(new Set(Array.from(this.contextNotes.values()).flatMap((note) => note.sourceNode.projects))).sort(),
      },
    };
  }

  private indexFile(file: TFile): void {
    const parsed = this.parseFile(file);
    if (parsed.unresolvedLinks.length > 0) this.unresolvedLinksByFile.set(file.path, parsed.unresolvedLinks);
    if (!parsed.indexedNote) {
      if (parsed.containedLinks) this.nonContributingNotes.add(file.path);
      return;
    }
    this.contextNotes.set(file.path, parsed.indexedNote);
    this.addContextNote(parsed.indexedNote);
  }

  private parseFile(sourceFile: TFile): ParsedContextNote {
    const cache = this.app.metadataCache.getFileCache(sourceFile);
    const linkCaches: CachedLink[] = [...(cache?.links ?? []), ...(cache?.frontmatterLinks ?? [])];
    const unresolvedLinks: string[] = [];
    const sourceNode = this.createGraphNode(sourceFile);
    if (linkCaches.length === 0) return { indexedNote: null, unresolvedLinks, containedLinks: false };

    const referencedNodes = new Map<string, GraphEntityNode>();
    for (const linkCache of linkCaches) {
      const destination = this.app.metadataCache.getFirstLinkpathDest(linkCache.link, sourceFile.path);
      if (!destination) {
        unresolvedLinks.push(`${sourceFile.path}: [[${linkCache.link}]]`);
        continue;
      }
      if (destination.extension === "md") referencedNodes.set(destination.path, this.createGraphNode(destination));
    }

    const parsedNote: ParsedSourceNote = {
      sourceNotePath: sourceFile.path,
      sourceNoteName: sourceFile.basename,
      sourceNode,
      referencedNodes: Array.from(referencedNodes.values()),
      timestamp: sourceFile.stat.mtime,
      projects: sourceNode.projects,
    };
    const contributions = this.rules.flatMap((rule) => rule.calculate(parsedNote));
    if (contributions.length === 0) return { indexedNote: null, unresolvedLinks, containedLinks: true };

    return {
      indexedNote: {
        sourceNotePath: sourceFile.path,
        sourceNoteName: sourceFile.basename,
        sourceNode,
        referencedNodes: parsedNote.referencedNodes,
        contributions,
      },
      unresolvedLinks,
      containedLinks: true,
    };
  }

  private addContextNote(note: IndexedContextNote): void {
    this.retainNode(note.sourceNode);
    for (const node of note.referencedNodes) this.retainNode(node);
    for (const contribution of note.contributions) {
      const id = this.createPairKey(contribution.source, contribution.target);
      const existing = this.relationships.get(id);
      if (existing) existing.contributions.push(contribution);
      else this.relationships.set(id, { id, source: contribution.source, target: contribution.target, contributions: [contribution] });
    }
  }

  private subtractContextNote(note: IndexedContextNote): void {
    for (const contribution of note.contributions) {
      const id = this.createPairKey(contribution.source, contribution.target);
      const existing = this.relationships.get(id);
      if (!existing) continue;
      existing.contributions = existing.contributions.filter((item) => !(item.evidencePath === contribution.evidencePath && item.ruleId === contribution.ruleId && item.source === contribution.source && item.target === contribution.target));
      if (existing.contributions.length === 0) this.relationships.delete(id);
    }
    this.releaseNode(note.sourceNode.id);
    for (const node of note.referencedNodes) this.releaseNode(node.id);
  }

  private retainNode(node: GraphEntityNode): void {
    this.nodes.set(node.id, node);
    this.nodeReferenceCounts.set(node.id, (this.nodeReferenceCounts.get(node.id) ?? 0) + 1);
  }

  private releaseNode(nodeId: string): void {
    const count = (this.nodeReferenceCounts.get(nodeId) ?? 1) - 1;
    if (count <= 0) {
      this.nodeReferenceCounts.delete(nodeId);
      this.nodes.delete(nodeId);
    } else this.nodeReferenceCounts.set(nodeId, count);
  }

  private createGraphNode(file: TFile): GraphEntityNode {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const tags = new Set<string>();
    for (const tag of cache?.tags ?? []) tags.add(tag.tag.replace(/^#/, ""));
    for (const tag of this.toStringArray(frontmatter?.tags)) tags.add(tag.replace(/^#/, ""));
    const projects = [
      ...this.toStringArray(frontmatter?.project),
      ...this.toStringArray(frontmatter?.projects),
    ].map((value) => value.replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);

    return {
      id: file.path,
      filePath: file.path,
      label: file.basename,
      folder: file.parent?.path === "/" ? "" : (file.parent?.path ?? ""),
      tags: Array.from(tags).sort(),
      projects: Array.from(new Set(projects)).sort(),
      modifiedTime: file.stat.mtime,
    };
  }

  private toStringArray(value: unknown): string[] {
    if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return [];
  }

  private recencyMultiplier(timestamp: number, now: number, settings: WeightedRelationshipGraphSettings): number {
    if (!settings.recencyEnabled) return 1;
    const halfLifeMs = Math.max(1, settings.recencyHalfLifeDays) * 86_400_000;
    return Math.pow(0.5, Math.max(0, now - timestamp) / halfLifeMs);
  }

  private nodeMatches(node: GraphEntityNode, search: string): boolean {
    return [node.label, node.filePath, node.folder, ...node.tags, ...node.projects]
      .some((value) => value.toLocaleLowerCase().includes(search));
  }

  private createPairKey(first: string, second: string): string {
    return `${first}\u0000${second}`;
  }
}
