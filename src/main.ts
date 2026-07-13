import {
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

import {
  RELATIONSHIP_GRAPH_VIEW_TYPE,
} from "./constants";

import {
  DEFAULT_SETTINGS,
  type WeightedRelationshipGraphSettings,
} from "./settings";

import {
  WeightedRelationshipGraphSettingTab,
} from "./settings-tab";

import {
  RelationshipGraphView,
} from "./relationship-graph-view";

import {
  VaultRelationshipIndex,
} from "./index/vault-relationship-index";

export default class WeightedRelationshipGraphPlugin extends Plugin {
  settings: WeightedRelationshipGraphSettings =
    DEFAULT_SETTINGS;

  relationshipIndex!: VaultRelationshipIndex;

  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.relationshipIndex =
      new VaultRelationshipIndex(
        this.app,
        () => this.settings,
      );

    this.registerView(
      RELATIONSHIP_GRAPH_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new RelationshipGraphView(
          leaf,
          this,
        ),
    );

    this.addCommand({
      id: "open-relationship-graph",
      name: "Open Relationship Graph",
      callback: async () => {
        await this.activateView();
      },
    });

    this.addRibbonIcon(
      "git-fork",
      "Open Relationship Graph",
      async () => {
        await this.activateView();
      },
    );

    this.addSettingTab(
      new WeightedRelationshipGraphSettingTab(
        this.app,
        this,
      ),
    );

    /*
     * Build the complete index once Obsidian has finished
     * loading the workspace and metadata cache.
     */
    this.app.workspace.onLayoutReady(() => {
      this.relationshipIndex.rebuild();

      void this.refreshOpenViews();
    });

    /*
     * Re-index only the Markdown note whose metadata changed.
     */
    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        (file) => {
          this.relationshipIndex.updateFile(file);
          this.scheduleRefresh();
        },
      ),
    );

    /*
     * Remove the deleted source note's contributions.
     */
    this.registerEvent(
      this.app.vault.on(
        "delete",
        (file) => {
          if (!(file instanceof TFile)) {
            return;
          }

          if (file.extension !== "md") {
            return;
          }

          this.relationshipIndex.removeFile(
            file.path,
          );

          this.scheduleRefresh();
        },
      ),
    );

    /*
     * A rename can affect both source-note paths and resolved
     * link targets across the vault. Use a safe full rebuild.
     */
    this.registerEvent(
      this.app.vault.on(
        "rename",
        (file) => {
          if (!(file instanceof TFile)) {
            return;
          }

          if (file.extension !== "md") {
            return;
          }

          window.setTimeout(() => {
            this.relationshipIndex.rebuild();

            void this.refreshOpenViews();
          }, 300);
        },
      ),
    );
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(
        this.refreshTimer,
      );

      this.refreshTimer = null;
    }

    this.app.workspace.detachLeavesOfType(
      RELATIONSHIP_GRAPH_VIEW_TYPE,
    );
  }

  async loadSettings(): Promise<void> {
    const savedData =
      (await this.loadData()) as
        | Partial<WeightedRelationshipGraphSettings>
        | null;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(savedData ?? {}),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    /*
     * Current settings only affect projection and layout,
     * so the vault index does not need to be rebuilt.
     */
    await this.refreshOpenViews();
  }

  async activateView(): Promise<void> {
    const existingLeaves =
      this.app.workspace.getLeavesOfType(
        RELATIONSHIP_GRAPH_VIEW_TYPE,
      );

    let leaf = existingLeaves[0];

    if (!leaf) {
      leaf =
        this.app.workspace.getLeaf("tab");

      await leaf.setViewState({
        type: RELATIONSHIP_GRAPH_VIEW_TYPE,
        active: true,
      });
    }

    await this.app.workspace.revealLeaf(
      leaf,
    );
  }

  async rebuildRelationshipIndex(): Promise<void> {
    this.relationshipIndex.rebuild();

    await this.refreshOpenViews();
  }

  async refreshOpenViews(): Promise<void> {
    const leaves =
      this.app.workspace.getLeavesOfType(
        RELATIONSHIP_GRAPH_VIEW_TYPE,
      );

    for (const leaf of leaves) {
      if (
        leaf.view instanceof
        RelationshipGraphView
      ) {
        await leaf.view.refresh();
      }
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(
        this.refreshTimer,
      );
    }

    this.refreshTimer =
      window.setTimeout(() => {
        this.refreshTimer = null;

        void this.refreshOpenViews();
      }, 750);
  }
}