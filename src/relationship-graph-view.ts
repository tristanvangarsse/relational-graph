import {
  ButtonComponent,
  ItemView,
  Notice,
  WorkspaceLeaf,
} from "obsidian";
import { UndirectedGraph } from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import Sigma from "sigma";

import { RELATIONSHIP_GRAPH_VIEW_TYPE } from "./constants";
import type WeightedRelationshipGraphPlugin from "./main";
import type {
  GraphFilters,
  Relationship,
  ScanResult,
} from "./types";

export class RelationshipGraphView extends ItemView {
  private renderer: Sigma | null = null;
  private layout: FA2Layout | null = null;

  private graphContainerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private detailsEl: HTMLElement | null = null;
  private filterControlsEl: HTMLElement | null = null;

  private physicsButton: ButtonComponent | null = null;
  private filters: GraphFilters;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: WeightedRelationshipGraphPlugin,
  ) {
    super(leaf);

    this.filters = {
      minimumWeight: plugin.settings.minimumWeight,
      searchQuery: "",
      folder: "",
      ruleId: "",
      project: "",
      recentDays: 0,
    };
  }

  getViewType(): string {
    return RELATIONSHIP_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Relational graph";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("relationship-graph-view");

    const toolbarEl = this.contentEl.createDiv({
      cls: "relationship-graph-toolbar",
    });

    new ButtonComponent(toolbarEl)
      .setButtonText("Refresh")
      .setTooltip("Rebuild the full index")
      .onClick(async () => {
        await this.plugin.rebuildRelationshipIndex();
      });

    new ButtonComponent(toolbarEl)
      .setButtonText("Re-layout")
      .setTooltip("Randomize positions and run the graph layout again")
      .onClick(() => {
        this.randomizeNodePositions();
        this.startLayout();
      });

    this.physicsButton = new ButtonComponent(toolbarEl)
      .setButtonText("Pause physics")
      .setTooltip("Pause or resume graph physics")
      .onClick(() => {
        this.togglePhysics();
      });

    new ButtonComponent(toolbarEl)
      .setButtonText("Reset camera")
      .setTooltip("Center the graph")
      .onClick(() => {
        this.renderer?.getCamera().animatedReset();
      });

    this.statusEl = toolbarEl.createDiv({
      cls: "relationship-graph-status",
      text: "Preparing graph…",
    });

    this.filterControlsEl = this.contentEl.createDiv({
      cls: "relationship-graph-filters",
    });

    const bodyEl = this.contentEl.createDiv({
      cls: "relationship-graph-body",
    });

    this.graphContainerEl = bodyEl.createDiv({
      cls: "relationship-graph-canvas",
    });

    this.detailsEl = bodyEl.createDiv({
      cls: "relationship-graph-details",
    });

    this.showDefaultDetails();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.destroyGraph();

    this.physicsButton = null;
    this.graphContainerEl = null;
    this.statusEl = null;
    this.detailsEl = null;
    this.filterControlsEl = null;
  }

  async refresh(): Promise<void> {
    if (!this.graphContainerEl || !this.statusEl) {
      return;
    }

    this.statusEl.setText("Updating graph…");

    try {
      const result =
        this.plugin.relationshipIndex.getScanResult(this.filters);

      this.renderFilterToolbar(result);
      this.renderResult(result);
    } catch (error) {
      console.error("Relational graph scan failed", error);

      this.statusEl.setText("Graph update failed");

      new Notice(
        "Relational graph: update failed. Check the developer console.",
      );
    }
  }

  private renderFilterToolbar(result: ScanResult): void {
    if (!this.filterControlsEl) {
      return;
    }

    this.filterControlsEl.empty();

    this.createSearch(this.filterControlsEl);

    this.createNumberFilter(
      this.filterControlsEl,
      "Min strength",
      this.filters.minimumWeight,
      0.1,
      (value) => {
        this.filters.minimumWeight = Math.max(0, value);
      },
    );

    this.createSelect(
      this.filterControlsEl,
      "Folder",
      this.filters.folder,
      [
        {
          value: "",
          label: "All folders",
        },
        ...result.filterOptions.folders.map((folder) => ({
          value: folder,
          label: folder,
        })),
      ],
      (value) => {
        this.filters.folder = value;
      },
    );

    this.createSelect(
      this.filterControlsEl,
      "Rule",
      this.filters.ruleId,
      [
        {
          value: "",
          label: "All rules",
        },
        ...result.filterOptions.ruleIds.map((rule) => ({
          value: rule.id,
          label: rule.label,
        })),
      ],
      (value) => {
        this.filters.ruleId = value;
      },
    );

    this.createSelect(
      this.filterControlsEl,
      "Project",
      this.filters.project,
      [
        {
          value: "",
          label: "All projects",
        },
        ...result.filterOptions.projects.map((project) => ({
          value: project,
          label: project,
        })),
      ],
      (value) => {
        this.filters.project = value;
      },
    );

    this.createSelect(
      this.filterControlsEl,
      "Recency",
      String(this.filters.recentDays),
      [
        {
          value: "0",
          label: "Any time",
        },
        {
          value: "7",
          label: "Last 7 days",
        },
        {
          value: "30",
          label: "Last 30 days",
        },
        {
          value: "90",
          label: "Last 90 days",
        },
        {
          value: "365",
          label: "Last year",
        },
      ],
      (value) => {
        this.filters.recentDays = Number(value);
      },
    );

    const clearButton = this.filterControlsEl.createEl("button", {
      text: "Clear filters",
      cls: "mod-muted",
    });

    clearButton.addEventListener("click", () => {
      this.filters = {
        minimumWeight: this.plugin.settings.minimumWeight,
        searchQuery: "",
        folder: "",
        ruleId: "",
        project: "",
        recentDays: 0,
      };

      void this.refresh();
    });
  }

  private createSearch(parent: HTMLElement): void {
    const label = parent.createEl("label", {
      cls: "relationship-graph-filter",
    });

    label.createSpan({
      text: "Search",
    });

    const input = label.createEl("input", {
      type: "search",
      placeholder: "Name, path, tag…",
    });

    input.value = this.filters.searchQuery;

    let timer: number | null = null;

    input.addEventListener("input", () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }

      timer = window.setTimeout(() => {
        this.filters.searchQuery = input.value;
        void this.refresh();
      }, 250);
    });
  }

  private createNumberFilter(
    parent: HTMLElement,
    text: string,
    value: number,
    step: number,
    apply: (value: number) => void,
  ): void {
    const label = parent.createEl("label", {
      cls: "relationship-graph-filter relationship-graph-filter-number",
    });

    label.createSpan({
      text,
    });

    const input = label.createEl("input", {
      type: "number",
    });

    input.min = "0";
    input.step = String(step);
    input.value = value.toFixed(1);

    input.addEventListener("change", () => {
      apply(Number(input.value) || 0);
      void this.refresh();
    });
  }

  private createSelect(
    parent: HTMLElement,
    text: string,
    value: string,
    options: Array<{
      value: string;
      label: string;
    }>,
    apply: (value: string) => void,
  ): void {
    const label = parent.createEl("label", {
      cls: "relationship-graph-filter",
    });

    label.createSpan({
      text,
    });

    const select = label.createEl("select");

    for (const option of options) {
      const optionEl = select.createEl("option", {
        text: option.label,
        value: option.value,
      });

      optionEl.selected = option.value === value;
    }

    select.addEventListener("change", () => {
      apply(select.value);
      void this.refresh();
    });
  }

  private renderResult(result: ScanResult): void {
    this.destroyGraph();

    if (!this.graphContainerEl || !this.statusEl) {
      return;
    }

    this.graphContainerEl.empty();

    const { graph: data, diagnostics } = result;

    this.statusEl.setText(
      `${data.nodes.length} notes · ` +
        `${data.relationships.length} relationships · ` +
        `${diagnostics.contributingNotes} indexed sources`,
    );

    if (data.nodes.length === 0) {
      this.graphContainerEl.createDiv({
        cls: "relationship-graph-empty",
        text: "No relationships match the current filters.",
      });

      this.showDefaultDetails();
      this.updatePhysicsButton();
      return;
    }

    const graph = new UndirectedGraph();

    const edgeColor = this.readCssColor(
      "--text-faint",
      "#888888",
    );

    const degree = new Map<string, number>();

    for (const relationship of data.relationships) {
      degree.set(
        relationship.source,
        (degree.get(relationship.source) ?? 0) + 1,
      );

      degree.set(
        relationship.target,
        (degree.get(relationship.target) ?? 0) + 1,
      );
    }

    const nodeCount = Math.max(data.nodes.length, 1);
    const initialRadius = Math.max(
      20,
      Math.sqrt(nodeCount) * 12,
    );

    data.nodes.forEach((node, index) => {
      const nodeDegree = degree.get(node.id) ?? 0;

      const isProjectFocused =
        this.filters.project !== "" &&
        node.projects.includes(this.filters.project);

      const angle = (index / nodeCount) * Math.PI * 2;
      const jitter = 4;

      graph.addNode(node.id, {
        label: node.label,
        filePath: node.filePath,

        x:
          Math.cos(angle) * initialRadius +
          (Math.random() - 0.5) * jitter,

        y:
          Math.sin(angle) * initialRadius +
          (Math.random() - 0.5) * jitter,

        size:
          (5 +
            Math.sqrt(nodeDegree + 1) * 2.5 +
            (isProjectFocused ? 2 : 0)) *
          this.plugin.settings.nodeSizeScale,

        color: this.nodeColor(
          node.folder,
          isProjectFocused,
        ),

        forceLabel: isProjectFocused,
        fixed: false,
        highlighted: false,
      });
    });

    for (const relationship of data.relationships) {
      if (
        !graph.hasNode(relationship.source) ||
        !graph.hasNode(relationship.target)
      ) {
        continue;
      }

      /*
       * ForceAtlas2 reads the edge's "weight" attribute as its
       * attraction strength. Clamping prevents unusually strong
       * relationships from collapsing their nodes together.
       */
      const physicsWeight = Math.max(
        0.25,
        Math.min(
          4,
          Math.sqrt(Math.max(relationship.weight, 0)),
        ),
      );

      const edgeSize =
        0.75 +
        Math.sqrt(Math.max(relationship.weight, 0)) *
          1.4;

      graph.addEdgeWithKey(
        relationship.id,
        relationship.source,
        relationship.target,
        {
          weight: physicsWeight,
          relationshipWeight: relationship.weight,
          size: edgeSize,
          color: edgeColor,
          label: relationship.weight.toFixed(2),
          relationship,
        },
      );
    }

    this.renderer = new Sigma(
      graph,
      this.graphContainerEl,
      {
        labelRenderedSizeThreshold: 7,
        renderEdgeLabels: false,
        enableEdgeEvents: true,
        defaultEdgeColor: edgeColor,
        defaultEdgeType: "line",
      },
    );

    this.registerRendererInteractions(graph);
    this.startLayout();
  }

  private registerRendererInteractions(
    graph: UndirectedGraph,
  ): void {
    if (!this.renderer) {
      return;
    }

    let draggedNode: string | null = null;
    let movedDuringDrag = false;
    let suppressClickNode: string | null = null;

    this.renderer.on("clickNode", ({ node }) => {
      if (suppressClickNode === node) {
        suppressClickNode = null;
        return;
      }

      const filePath = graph.getNodeAttribute(
        node,
        "filePath",
      ) as string;

      void this.app.workspace.openLinkText(
        filePath,
        "",
        "tab",
      );
    });

    this.renderer.on("clickEdge", ({ edge }) => {
      const relationship = graph.getEdgeAttribute(
        edge,
        "relationship",
      ) as Relationship;

      this.showRelationshipDetails(
        relationship,
        graph.getNodeAttribute(
          relationship.source,
          "label",
        ) as string,
        graph.getNodeAttribute(
          relationship.target,
          "label",
        ) as string,
      );
    });

    this.renderer.on("enterNode", ({ node }) => {
      graph.setNodeAttribute(
        node,
        "highlighted",
        true,
      );

      if (this.graphContainerEl) {
        this.graphContainerEl.style.cursor = "pointer";
      }
    });

    this.renderer.on("leaveNode", ({ node }) => {
      if (draggedNode !== node) {
        graph.setNodeAttribute(
          node,
          "highlighted",
          false,
        );
      }

      if (
        this.graphContainerEl &&
        draggedNode === null
      ) {
        this.graphContainerEl.style.cursor = "default";
      }
    });

    this.renderer.on("downNode", ({ node }) => {
      draggedNode = node;
      movedDuringDrag = false;

      /*
       * Fixed nodes are not moved by ForceAtlas2. This prevents
       * physics from fighting the pointer during dragging.
       */
      graph.setNodeAttribute(node, "fixed", true);
      graph.setNodeAttribute(
        node,
        "highlighted",
        true,
      );

      if (!this.layout?.isRunning()) {
        this.layout?.start();
        this.updatePhysicsButton();
      }

      if (!this.renderer?.getCustomBBox()) {
        const box = this.renderer?.getBBox();

        if (box) {
          this.renderer?.setCustomBBox(box);
        }
      }

      if (this.graphContainerEl) {
        this.graphContainerEl.style.cursor = "grabbing";
      }
    });

    this.renderer.on("moveBody", ({ event }) => {
      if (!draggedNode || !this.renderer) {
        return;
      }

      movedDuringDrag = true;

      const position =
        this.renderer.viewportToGraph(event);

      graph.setNodeAttribute(
        draggedNode,
        "x",
        position.x,
      );

      graph.setNodeAttribute(
        draggedNode,
        "y",
        position.y,
      );

      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });

    const finishDragging = (): void => {
      if (!draggedNode) {
        return;
      }

      const releasedNode = draggedNode;

      graph.setNodeAttribute(
        releasedNode,
        "highlighted",
        false,
      );

      /*
       * Change this value to true if dragged nodes should stay
       * permanently pinned after the pointer is released.
       */
      graph.setNodeAttribute(
        releasedNode,
        "fixed",
        false,
      );

      if (movedDuringDrag) {
        suppressClickNode = releasedNode;

        window.setTimeout(() => {
          if (suppressClickNode === releasedNode) {
            suppressClickNode = null;
          }
        }, 350);
      }

      draggedNode = null;
      movedDuringDrag = false;

      if (this.graphContainerEl) {
        this.graphContainerEl.style.cursor = "default";
      }
    };

    this.renderer.on("upNode", finishDragging);
    this.renderer.on("upStage", finishDragging);
  }

  private showRelationshipDetails(
    relationship: Relationship,
    sourceLabel: string,
    targetLabel: string,
  ): void {
    if (!this.detailsEl) {
      return;
    }

    this.detailsEl.empty();

    this.detailsEl.createEl("h3", {
      text: `${sourceLabel} ↔ ${targetLabel}`,
    });

    this.detailsEl.createEl("p", {
      text:
        `Weighted strength: ` +
        `${relationship.weight.toFixed(2)} · ` +
        `Raw evidence: ${relationship.rawWeight}`,
    });

    if (relationship.projects.length > 0) {
      this.detailsEl.createEl("p", {
        text:
          `Projects: ` +
          relationship.projects.join(", "),
      });
    }

    this.detailsEl.createEl("h4", {
      text: "Rule totals",
    });

    const ruleList = this.detailsEl.createEl("ul");

    const sortedRuleTotals = Object.entries(
      relationship.weightByRule,
    ).sort(([firstRule], [secondRule]) =>
      firstRule.localeCompare(secondRule),
    );

    for (const [ruleId, weight] of sortedRuleTotals) {
      ruleList.createEl("li", {
        text: `${ruleId}: ${weight.toFixed(2)}`,
      });
    }

    this.detailsEl.createEl("h4", {
      text: "Evidence",
    });

    const evidenceList =
      this.detailsEl.createEl("ul");

    const sortedEvidence = [
      ...relationship.evidence,
    ].sort(
      (first, second) =>
        second.timestamp - first.timestamp,
    );

    for (const evidence of sortedEvidence) {
      const item = evidenceList.createEl("li");

      const link = item.createEl("a", {
        text: evidence.sourceNoteName,
        href: "#",
      });

      item.createSpan({
        text:
          ` — ${evidence.ruleLabel}, ` +
          `${evidence.weightedValue.toFixed(2)}, ` +
          new Date(
            evidence.timestamp,
          ).toLocaleDateString(),
      });

      link.addEventListener("click", (event) => {
        event.preventDefault();

        void this.app.workspace.openLinkText(
          evidence.sourceNotePath,
          "",
          "tab",
        );
      });
    }
  }

  private showDefaultDetails(): void {
    if (!this.detailsEl) {
      return;
    }

    this.detailsEl.empty();

    this.detailsEl.createEl("h3", {
      text: "Relationship details",
    });

    this.detailsEl.createEl("p", {
      text:
        "Click an edge to inspect its rules, " +
        "recency-adjusted strength, projects, " +
        "and evidence notes.",
    });
  }

  private nodeColor(
    folder: string,
    focused: boolean,
  ): string {
    if (focused) {
      return this.readCssColor(
        "--interactive-accent",
        "#7f6df2",
      );
    }

    const palette = [
      "--color-blue",
      "--color-cyan",
      "--color-green",
      "--color-orange",
      "--color-pink",
      "--color-purple",
      "--color-red",
      "--color-yellow",
    ];

    let hash = 0;

    for (const character of folder || "root") {
      hash =
        ((hash << 5) -
          hash +
          character.charCodeAt(0)) |
        0;
    }

    const colorVariable =
      palette[Math.abs(hash) % palette.length] ??
      "--interactive-accent";

    return this.readCssColor(
      colorVariable,
      "#7f6df2",
    );
  }

  private startLayout(): void {
    if (!this.renderer) {
      return;
    }

    const graph = this.renderer.getGraph();

    if (graph.order < 2) {
      this.updatePhysicsButton();
      return;
    }

    this.stopAndKillLayout();

    this.layout = new FA2Layout(graph, {
      settings: {
        /*
         * Prevent nodes from overlapping based on their
         * rendered sizes.
         */
        adjustSizes: true,

        /*
         * Improve performance for larger graphs.
         */
        barnesHutOptimize: graph.order > 250,

        /*
         * Pull disconnected groups toward the center.
         */
        gravity: 0.8,

        /*
         * Increase this value to put more space between nodes.
         */
        scalingRatio: 5,

        /*
         * Higher values reduce movement speed and jitter.
         */
        slowDown: 10,

        /*
         * Use relationship weights as attraction strengths.
         */
        edgeWeightInfluence: 1,

        /*
         * Create more visible clustering.
         */
        linLogMode: true,

        outboundAttractionDistribution: false,
        strongGravityMode: false,
      },
    });

    this.layout.start();
    this.updatePhysicsButton();
  }

  private togglePhysics(): void {
    if (!this.renderer) {
      return;
    }

    if (!this.layout) {
      this.startLayout();
      return;
    }

    if (this.layout.isRunning()) {
      this.layout.stop();
    } else {
      this.layout.start();
    }

    this.updatePhysicsButton();
  }

  private updatePhysicsButton(): void {
    if (!this.physicsButton) {
      return;
    }

    const isRunning =
      this.layout?.isRunning() ?? false;

    this.physicsButton.setButtonText(
      isRunning
        ? "Pause physics"
        : "Resume physics",
    );

    this.physicsButton.setTooltip(
      isRunning
        ? "Pause graph physics"
        : "Resume graph physics",
    );
  }

  private randomizeNodePositions(): void {
    if (!this.renderer) {
      return;
    }

    const graph = this.renderer.getGraph();
    const nodes = graph.nodes();

    if (nodes.length === 0) {
      return;
    }

    const radius = Math.max(
      20,
      Math.sqrt(nodes.length) * 12,
    );

    nodes.forEach((node, index) => {
      const angle =
        (index / nodes.length) * Math.PI * 2;

      graph.mergeNodeAttributes(node, {
        x:
          Math.cos(angle) * radius +
          (Math.random() - 0.5) * 8,

        y:
          Math.sin(angle) * radius +
          (Math.random() - 0.5) * 8,

        fixed: false,
      });
    });

    this.renderer.getCamera().animatedReset();
  }

  private stopAndKillLayout(): void {
    if (!this.layout) {
      this.updatePhysicsButton();
      return;
    }

    if (this.layout.isRunning()) {
      this.layout.stop();
    }

    this.layout.kill();
    this.layout = null;

    this.updatePhysicsButton();
  }

  private destroyGraph(): void {
    this.stopAndKillLayout();

    this.renderer?.kill();
    this.renderer = null;

    this.updatePhysicsButton();
  }

  private readCssColor(
    variableName: string,
    fallback: string,
  ): string {
    return (
      window
        .getComputedStyle(document.body)
        .getPropertyValue(variableName)
        .trim() || fallback
    );
  }
}