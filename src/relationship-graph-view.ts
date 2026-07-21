import {
  ButtonComponent,
  ItemView,
  Notice,
  WorkspaceLeaf,
} from "obsidian";
import { UndirectedGraph } from "graphology";
import ForceSupervisor from "graphology-layout-force/worker";
import Sigma from "sigma";

import { RELATIONSHIP_GRAPH_VIEW_TYPE } from "./constants";
import type WeightedRelationshipGraphPlugin from "./main";
import type {
  GraphFilters,
  ScanResult,
} from "./types";

const ACTIVE_COLOR = "#4f9cff";
const INITIAL_LAYOUT_MAX_MS = 10_000;
const FIRST_HOP_DRAG_CARRY = 0.16;
const SECOND_HOP_DRAG_CARRY = 0.04;

export class RelationshipGraphView extends ItemView {
  private renderer: Sigma | null = null;
  private layout: ForceSupervisor | null = null;
  private layoutStopTimer: number | null = null;

  private graphContainerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private filterControlsEl: HTMLElement | null = null;
  private settingsPanelEl: HTMLElement | null = null;

  private physicsButton: ButtonComponent | null = null;
  private physicsEnabled = true;
  private focusedNode: string | null = null;
  private focusedNeighbors = new Set<string>();
  private focusedEdges = new Set<string>();

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

    const bodyEl = this.contentEl.createDiv({
      cls: "relationship-graph-body",
    });

    this.graphContainerEl = bodyEl.createDiv({
      cls: "relationship-graph-canvas",
    });

    const statusBarEl = bodyEl.createDiv({
      cls: "relationship-graph-floating-status",
    });

    this.statusEl = statusBarEl.createDiv({
      cls: "relationship-graph-status",
      text: "Preparing graph…",
    });

    const controlsEl = bodyEl.createDiv({
      cls: "relationship-graph-floating-controls",
    });

    const settingsButton = new ButtonComponent(controlsEl)
      .setIcon("settings")
      .setTooltip("Graph controls and filters");

    settingsButton.buttonEl.addClass("clickable-icon");
    settingsButton.onClick(() => {
      const panel = this.settingsPanelEl;
      if (!panel) {
        return;
      }

      const isOpen = panel.hasClass("is-open");
      panel.toggleClass("is-open", !isOpen);
      panel.setAttribute("aria-hidden", String(isOpen));
      settingsButton.buttonEl.toggleClass("is-active", !isOpen);
    });

    this.settingsPanelEl = bodyEl.createDiv({
      cls: "relationship-graph-settings-panel",
      attr: { "aria-hidden": "true" },
    });

    const graphControls = this.createSettingsSection(
      this.settingsPanelEl,
      "Graph controls",
      true,
    );

    new ButtonComponent(graphControls)
      .setButtonText("Refresh")
      .setTooltip("Rebuild the full index")
      .onClick(async () => {
        await this.plugin.rebuildRelationshipIndex();
      });

    new ButtonComponent(graphControls)
      .setButtonText("Re-layout")
      .setTooltip("Randomize positions and settle the graph again")
      .onClick(() => {
        this.randomizeNodePositions();
        this.wakePhysics(INITIAL_LAYOUT_MAX_MS);
      });

    this.physicsButton = new ButtonComponent(graphControls)
      .setButtonText("Pause physics")
      .setTooltip("Disable or enable automatic graph physics")
      .onClick(() => {
        this.physicsEnabled = !this.physicsEnabled;

        if (this.physicsEnabled) {
          this.wakePhysics(INITIAL_LAYOUT_MAX_MS);
        } else {
          this.stopLayout();
        }

        this.updatePhysicsButton();
      });

    new ButtonComponent(graphControls)
      .setButtonText("Reset camera")
      .setTooltip("Center the graph")
      .onClick(() => {
        void this.renderer?.getCamera().animatedReset();
      });

    this.filterControlsEl = this.createSettingsSection(
      this.settingsPanelEl,
      "Filters",
      true,
    );

    /*
     * setViewState() waits for onOpen() before activateView() can reveal the
     * new leaf. Rendering Sigma here synchronously can therefore see a
     * zero-sized container and fail on the first open. Let onOpen() finish,
     * then initialize once Obsidian has revealed and sized the view.
     */
    void this.initializeGraphWhenVisible();
  }

  private async initializeGraphWhenVisible(): Promise<void> {
    await this.plugin.ensureRelationshipIndexReady();

    const hasLayout = await this.waitForContainerLayout(2_500);
    if (!hasLayout || !this.graphContainerEl || !this.statusEl) {
      return;
    }

    await this.refresh();
  }

  private createSettingsSection(
    parent: HTMLElement,
    title: string,
    open: boolean,
  ): HTMLElement {
    const section = parent.createEl("details", {
      cls: "relationship-graph-settings-section",
    });

    section.open = open;
    section.createEl("summary", { text: title });

    return section.createDiv({
      cls: "relationship-graph-settings-section-content",
    });
  }

  async onClose(): Promise<void> {
    this.destroyGraph();

    this.physicsButton = null;
    this.graphContainerEl = null;
    this.statusEl = null;
    this.filterControlsEl = null;
    this.settingsPanelEl = null;
  }

  async refresh(): Promise<void> {
    if (!this.graphContainerEl || !this.statusEl) {
      return;
    }

    if (!this.hasContainerLayout()) {
      this.statusEl.setText("Waiting for graph view…");
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
        { value: "", label: "All folders" },
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
        { value: "", label: "All rules" },
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
        { value: "", label: "All projects" },
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
        { value: "0", label: "Any time" },
        { value: "7", label: "Last 7 days" },
        { value: "30", label: "Last 30 days" },
        { value: "90", label: "Last 90 days" },
        { value: "365", label: "Last year" },
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

    label.createSpan({ text: "Search" });

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

    label.createSpan({ text });

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
    options: Array<{ value: string; label: string }>,
    apply: (value: string) => void,
  ): void {
    const label = parent.createEl("label", {
      cls: "relationship-graph-filter",
    });

    label.createSpan({ text });
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

      this.updatePhysicsButton();
      return;
    }

    const graph = new UndirectedGraph();
    const darkTheme = this.isDarkTheme();

    const labelColor = darkTheme
      ? "#f7f7f7"
      : "#17191c";

    const edgeColor = darkTheme
      ? "#747b85"
      : "#b5bac1";
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
    const initialRadius = Math.max(14, Math.sqrt(nodeCount) * 5.5);

    data.nodes.forEach((node, index) => {
      const nodeDegree = degree.get(node.id) ?? 0;
      const isProjectFocused =
        this.filters.project !== "" &&
        node.projects.includes(this.filters.project);
      const angle = index * 2.399963229728653;
      const radius = initialRadius * Math.sqrt((index + 0.5) / nodeCount);
      const jitter = 2;
      const size =
        (5 +
          Math.sqrt(nodeDegree + 1) * 2.5 +
          (isProjectFocused ? 2 : 0)) *
        this.plugin.settings.nodeSizeScale;

      graph.addNode(node.id, {
        label: node.label,
        filePath: node.filePath,
        x:
          Math.cos(angle) * radius +
          (Math.random() - 0.5) * jitter,
        y:
          Math.sin(angle) * radius +
          (Math.random() - 0.5) * jitter,
        size,
        baseSize: size,
        color: this.nodeColor(node.folder, isProjectFocused),
        forceLabel: isProjectFocused,
        fixed: false,
      });
    });

    const maximumRawWeight = Math.max(
      1,
      ...data.relationships.map((relationship) =>
        Math.max(0, relationship.rawWeight),
      ),
    );

    const minimumEdgeThickness = Math.max(
      0,
      this.plugin.settings.minimumEdgeThickness,
    );
    const maximumEdgeThickness = Math.max(
      minimumEdgeThickness,
      this.plugin.settings.maximumEdgeThickness,
    );

    for (const relationship of data.relationships) {
      if (
        !graph.hasNode(relationship.source) ||
        !graph.hasNode(relationship.target)
      ) {
        continue;
      }

      const normalizedWeight =
        Math.max(0, relationship.rawWeight) / maximumRawWeight;
      const edgeSize =
        minimumEdgeThickness +
        (maximumEdgeThickness - minimumEdgeThickness) *
          Math.pow(normalizedWeight, 2);

      graph.addEdgeWithKey(
        relationship.id,
        relationship.source,
        relationship.target,
        {
          weight: Math.max(0.25, relationship.weight),
          size: edgeSize,
          baseSize: edgeSize,
          color: edgeColor,
          label: relationship.weight.toFixed(2),
          relationship,
        },
      );
    }

    this.connectDisconnectedComponentsForLayout(graph);

    this.renderer = new Sigma(graph, this.graphContainerEl, {
      labelRenderedSizeThreshold: 4,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      defaultEdgeColor: edgeColor,
      defaultEdgeType: "line",
      labelColor: { color: labelColor },
      defaultDrawNodeHover: () => undefined,
      minCameraRatio: 0.05,
      maxCameraRatio: 20,
      zoomingRatio: 1.25,
      zoomDuration: 300,
      nodeReducer: (node, attributes) =>
        this.reduceNode(node, attributes),
      edgeReducer: (edge, attributes) =>
        this.reduceEdge(edge, attributes),
    });

    this.registerRendererInteractions(graph);
    this.createLayout(graph);
    this.wakePhysics(INITIAL_LAYOUT_MAX_MS);
    this.scheduleInitialRender();
  }

  private createLayout(graph: UndirectedGraph): void {
    this.layout?.kill();

    const graphSize = graph.order;
    const repulsion =
      graphSize > 1_000
        ? 0.006
        : graphSize > 400
          ? 0.009
          : 0.012;

    const attraction =
      graphSize > 1_000
        ? 0.0011
        : graphSize > 400
          ? 0.0014
          : 0.0018;

    const gravity =
      graphSize > 1_000
        ? 0.00012
        : graphSize > 400
          ? 0.00018
          : 0.00025;

    this.layout = new ForceSupervisor(graph, {
      isNodeFixed: "fixed",
      settings: {
        attraction,
        repulsion,
        gravity,
        inertia: 0.001,
        maxMove: graphSize > 1_000 ? 55 : graphSize > 400 ? 80 : 110,
      },
      onConverged: () => {
        this.clearLayoutStopTimer();
        this.updatePhysicsButton();
      },
    });
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
    let previousDragPosition: { x: number; y: number } | null = null;

    this.renderer.on("clickNode", ({ node }) => {
      if (suppressClickNode === node) {
        suppressClickNode = null;
        return;
      }

      const filePath = graph.getNodeAttribute(node, "filePath") as string;
      void this.app.workspace.openLinkText(filePath, "", "tab");
    });

    this.renderer.on("enterNode", ({ node }) => {
      if (draggedNode === null) {
        this.setFocus(graph, node);
      }

      if (this.graphContainerEl) {
        this.graphContainerEl.removeClass("is-dragging");
        this.graphContainerEl.addClass("is-node-hovered");
      }
    });

    this.renderer.on("leaveNode", () => {
      if (draggedNode === null) {
        this.clearFocus();
      }

      if (this.graphContainerEl && draggedNode === null) {
        this.graphContainerEl.removeClass("is-node-hovered", "is-dragging");
      }
    });

    this.renderer.on("downNode", ({ node, event }) => {
      draggedNode = node;
      movedDuringDrag = false;

      graph.setNodeAttribute(node, "fixed", true);
      previousDragPosition = {
        x: Number(graph.getNodeAttribute(node, "x")),
        y: Number(graph.getNodeAttribute(node, "y")),
      };
      this.setFocus(graph, node);
      this.wakePhysics(0);

      if (!this.renderer?.getCustomBBox()) {
        const box = this.renderer?.getBBox();
        if (box) {
          this.renderer?.setCustomBBox(box);
        }
      }

      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();

      if (this.graphContainerEl) {
        this.graphContainerEl.removeClass("is-node-hovered");
        this.graphContainerEl.addClass("is-dragging");
      }
    });

    this.renderer.on("moveBody", ({ event }) => {
      if (!draggedNode || !this.renderer) {
        return;
      }

      movedDuringDrag = true;
      const position = this.renderer.viewportToGraph(event);

      if (previousDragPosition) {
        this.carryConnectedNodes(
          graph,
          draggedNode,
          position.x - previousDragPosition.x,
          position.y - previousDragPosition.y,
        );
      }

      graph.mergeNodeAttributes(draggedNode, {
        x: position.x,
        y: position.y,
      });

      previousDragPosition = position;

      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });

    const finishDragging = (): void => {
      if (!draggedNode) {
        return;
      }

      const releasedNode = draggedNode;
      // Keep the released node anchored at its drop point. The surrounding
      // nodes remain free and settle around it through the spring forces.
      graph.setNodeAttribute(releasedNode, "fixed", true);

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
      previousDragPosition = null;
      this.clearFocus();
      this.renderer?.setCustomBBox(null);
      // Let the spring simulation settle naturally. ForceSupervisor stops
      // itself when it reaches convergence, avoiding an abrupt timed freeze.
      this.wakePhysics(0);

      if (this.graphContainerEl) {
        this.graphContainerEl.removeClass("is-node-hovered", "is-dragging");
      }
    };

    this.renderer.on("upNode", finishDragging);
    this.renderer.on("upStage", finishDragging);
  }


  private connectDisconnectedComponentsForLayout(
    graph: UndirectedGraph,
  ): void {
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const startNode of graph.nodes()) {
      if (visited.has(startNode)) {
        continue;
      }

      const component: string[] = [];
      const stack = [startNode];
      visited.add(startNode);

      while (stack.length > 0) {
        const node = stack.pop();

        if (node === undefined) {
          continue;
        }

        component.push(node);

        for (const neighbor of graph.neighbors(node)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    if (components.length <= 1) {
      return;
    }

    components.sort((a, b) => b.length - a.length);

    for (let index = 1; index < components.length; index += 1) {
      const previousComponent = components[index - 1];
      const currentComponent = components[index];

      if (!previousComponent || !currentComponent) {
        continue;
      }

      const { source, target } = this.findClosestNodePair(
        graph,
        previousComponent,
        currentComponent,
      );

      graph.addEdgeWithKey(
        `__layout_component_${index}`,
        source,
        target,
        {
          layoutOnly: true,
          hidden: true,
          size: 0,
          baseSize: 0,
          color: "transparent",
          label: "",
        },
      );
    }
  }

  private findClosestNodePair(
    graph: UndirectedGraph,
    firstComponent: string[],
    secondComponent: string[],
  ): { source: string; target: string } {
    let source = firstComponent[0] as string;
    let target = secondComponent[0] as string;
    let shortestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const firstNode of firstComponent) {
      const firstX = Number(graph.getNodeAttribute(firstNode, "x"));
      const firstY = Number(graph.getNodeAttribute(firstNode, "y"));

      for (const secondNode of secondComponent) {
        const deltaX =
          firstX - Number(graph.getNodeAttribute(secondNode, "x"));
        const deltaY =
          firstY - Number(graph.getNodeAttribute(secondNode, "y"));
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;

        if (distanceSquared < shortestDistanceSquared) {
          shortestDistanceSquared = distanceSquared;
          source = firstNode;
          target = secondNode;
        }
      }
    }

    return { source, target };
  }

  private realNeighbors(
    graph: UndirectedGraph,
    node: string,
  ): string[] {
    const neighbors: string[] = [];

    for (const edge of graph.edges(node)) {
      if (graph.getEdgeAttribute(edge, "layoutOnly") === true) {
        continue;
      }

      const source = graph.source(edge);
      const target = graph.target(edge);
      neighbors.push(source === node ? target : source);
    }

    return neighbors;
  }

  private carryConnectedNodes(
    graph: UndirectedGraph,
    draggedNode: string,
    deltaX: number,
    deltaY: number,
  ): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const firstHop = new Set(
      this.realNeighbors(graph, draggedNode),
    );
    const secondHop = new Set<string>();

    for (const neighbor of firstHop) {
      for (const candidate of this.realNeighbors(graph, neighbor)) {
        if (candidate !== draggedNode && !firstHop.has(candidate)) {
          secondHop.add(candidate);
        }
      }
    }

    for (const node of firstHop) {
      this.translateFreeNode(
        graph,
        node,
        deltaX * FIRST_HOP_DRAG_CARRY,
        deltaY * FIRST_HOP_DRAG_CARRY,
      );
    }

    for (const node of secondHop) {
      this.translateFreeNode(
        graph,
        node,
        deltaX * SECOND_HOP_DRAG_CARRY,
        deltaY * SECOND_HOP_DRAG_CARRY,
      );
    }
  }

  private translateFreeNode(
    graph: UndirectedGraph,
    node: string,
    deltaX: number,
    deltaY: number,
  ): void {
    if (graph.getNodeAttribute(node, "fixed")) {
      return;
    }

    graph.mergeNodeAttributes(node, {
      x: Number(graph.getNodeAttribute(node, "x")) + deltaX,
      y: Number(graph.getNodeAttribute(node, "y")) + deltaY,
    });
  }

  private setFocus(graph: UndirectedGraph, node: string): void {
    this.focusedNode = node;
    this.focusedNeighbors.clear();
    this.focusedEdges.clear();

    for (const edge of graph.edges(node)) {
      if (graph.getEdgeAttribute(edge, "layoutOnly") === true) {
        continue;
      }

      this.focusedEdges.add(edge);

      const source = graph.source(edge);
      const target = graph.target(edge);
      this.focusedNeighbors.add(source === node ? target : source);
    }

    this.renderer?.refresh();
  }

  private clearFocus(): void {
    if (this.focusedNode === null) {
      return;
    }

    this.focusedNode = null;
    this.focusedNeighbors.clear();
    this.focusedEdges.clear();
    this.renderer?.refresh();
  }

  private reduceNode(
    node: string,
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    if (this.focusedNode === null) {
      return attributes;
    }

    const isFocused = node === this.focusedNode;
    const isNeighbor = this.focusedNeighbors.has(node);

    if (isFocused) {
      return {
        ...attributes,
        color: ACTIVE_COLOR,
        size: Number(attributes.baseSize ?? attributes.size ?? 5) * 1.35,
        forceLabel: true,
        zIndex: 2,
      };
    }

    if (isNeighbor) {
      return {
        ...attributes,
        color: ACTIVE_COLOR,
        size: Number(attributes.baseSize ?? attributes.size ?? 5) * 1.08,
        forceLabel: true,
        zIndex: 1,
      };
    }

    return {
      ...attributes,
      color: this.dimmedNodeColor(),
      size: Number(attributes.baseSize ?? attributes.size ?? 5) * 0.78,
      forceLabel: false,
      zIndex: 0,
    };
  }

  private reduceEdge(
    edge: string,
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    if (attributes.layoutOnly === true) {
      return {
        ...attributes,
        hidden: true,
        size: 0,
        label: "",
      };
    }

    if (this.focusedNode === null) {
      return attributes;
    }

    if (this.focusedEdges.has(edge)) {
      return {
        ...attributes,
        color: ACTIVE_COLOR,
        size: Math.max(
          1,
          Number(attributes.baseSize ?? attributes.size ?? 1) * 1.2,
        ),
        zIndex: 1,
      };
    }

    return {
      ...attributes,
      color: this.dimmedEdgeColor(),
      size: Math.max(
        0.15,
        Number(attributes.baseSize ?? attributes.size ?? 1) * 0.35,
      ),
      zIndex: 0,
    };
  }

  private wakePhysics(maxRunMs: number): void {
    if (!this.physicsEnabled || !this.layout) {
      this.updatePhysicsButton();
      return;
    }

    this.clearLayoutStopTimer();

    if (!this.layout.isRunning()) {
      this.layout.start();
    }

    if (maxRunMs > 0) {
      this.layoutStopTimer = window.setTimeout(() => {
        this.layoutStopTimer = null;
        this.stopLayout();
      }, maxRunMs);
    }

    this.updatePhysicsButton();
  }

  private stopLayout(): void {
    this.clearLayoutStopTimer();

    if (this.layout?.isRunning()) {
      this.layout.stop();
    }

    this.updatePhysicsButton();
  }

  private clearLayoutStopTimer(): void {
    if (this.layoutStopTimer !== null) {
      window.clearTimeout(this.layoutStopTimer);
      this.layoutStopTimer = null;
    }
  }

  private updatePhysicsButton(): void {
    if (!this.physicsButton) {
      return;
    }

    if (!this.physicsEnabled) {
      this.physicsButton
        .setButtonText("Resume physics")
        .setTooltip("Enable automatic graph physics");
      return;
    }

    const running = this.layout?.isRunning() ?? false;

    this.physicsButton
      .setButtonText(running ? "Pause physics" : "Physics ready")
      .setTooltip(
        running
          ? "Pause graph physics"
          : "Physics is enabled and will wake on interaction",
      );
  }


  private scheduleInitialRender(): void {
    const renderer = this.renderer;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!renderer || renderer !== this.renderer) {
          return;
        }

        renderer.resize();
        renderer.refresh();
        void renderer.getCamera().animatedReset({ duration: 0 });
      });
    });
  }

  private hasContainerLayout(): boolean {
    const container = this.graphContainerEl;

    return Boolean(
      container &&
      container.isConnected &&
      container.clientWidth > 0 &&
      container.clientHeight > 0
    );
  }

  private async waitForContainerLayout(timeoutMs: number): Promise<boolean> {
    const start = window.performance.now();

    while (this.graphContainerEl && this.statusEl) {
      if (this.hasContainerLayout()) {
        return true;
      }

      if (window.performance.now() - start >= timeoutMs) {
        return false;
      }

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }

    return false;
  }

  private isDarkTheme(): boolean {
    return document.body.classList.contains("theme-dark");
  }

  private dimmedNodeColor(): string {
    return this.isDarkTheme() ? "#606874" : "#a0a6ad";
  }

  private dimmedEdgeColor(): string {
    return this.isDarkTheme() ? "#68717d" : "#d0d3d7";
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

    const radius = Math.max(20, Math.sqrt(nodes.length) * 12);

    nodes.forEach((node, index) => {
      const angle = (index / nodes.length) * Math.PI * 2;

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

    void this.renderer.getCamera().animatedReset();
  }

  private nodeColor(folder: string, focused: boolean): string {
    if (focused) {
      return this.readCssColor("--interactive-accent", "#7f6df2");
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
      hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    }

    const colorVariable =
      palette[Math.abs(hash) % palette.length] ??
      "--interactive-accent";

    return this.readCssColor(colorVariable, "#7f6df2");
  }

  private destroyGraph(): void {
    this.clearLayoutStopTimer();
    this.layout?.kill();
    this.layout = null;

    this.renderer?.kill();
    this.renderer = null;

    this.focusedNode = null;
    this.focusedNeighbors.clear();
    this.focusedEdges.clear();
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
