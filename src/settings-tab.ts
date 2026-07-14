import {
  App,
  PluginSettingTab,
  Setting,
} from "obsidian";
import type WeightedRelationshipGraphPlugin from "./main";
export class WeightedRelationshipGraphSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: WeightedRelationshipGraphPlugin,
  ) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Minimum relationship strength")
      .setDesc(
        "Default minimum weighted strength shown in the graph toolbar.",
      )
      .addSlider((slider) => {
        slider
          .setLimits(0.1, 25, 0.1)
          .setValue(this.plugin.settings.minimumWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.minimumWeight = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Recency weighting")
      .setDesc(
        "Reduce the influence of older relationship evidence.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.recencyEnabled)
          .onChange(async (value) => {
            this.plugin.settings.recencyEnabled = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Recency half-life")
      .setDesc(
        "After this many days, an evidence item contributes half its original weight.",
      )
      .addSlider((slider) => {
        slider
          .setLimits(7, 730, 7)
          .setValue(this.plugin.settings.recencyHalfLifeDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.recencyHalfLifeDays = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Shared-context rule")
      .setDesc(
        "Connect every pair of notes referenced by the same note.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(
            this.plugin.settings.enabledRuleIds.includes(
              "shared-context",
            ),
          )
          .onChange(async (value) => {
            await this.setRuleEnabled(
              "shared-context",
              value,
            );
          });
      });
    new Setting(containerEl)
      .setName("Direct-link rule")
      .setDesc(
        "Connect a source note directly to every Markdown note it links to.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(
            this.plugin.settings.enabledRuleIds.includes(
              "direct-link",
            ),
          )
          .onChange(async (value) => {
            await this.setRuleEnabled(
              "direct-link",
              value,
            );
          });
      });
    new Setting(containerEl)
      .setName("Node size scale")
      .setDesc(
        "Scale node sizes based on how many relationships each note has.",
      )
      .addSlider((slider) => {
        slider
          .setLimits(0.5, 2, 0.1)
          .setValue(this.plugin.settings.nodeSizeScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.nodeSizeScale = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Minimum edge thickness")
      .setDesc(
        "Set the thickness of the weakest visible relationship. Stronger relationships are scaled between this value and the maximum edge thickness.",
      )
      .addSlider((slider) => {
        slider
          .setLimits(0.1, 10, 0.1)
          .setValue(this.plugin.settings.minimumEdgeThickness)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.minimumEdgeThickness = value;

            if (
              this.plugin.settings.maximumEdgeThickness < value
            ) {
              this.plugin.settings.maximumEdgeThickness = value;
            }

            await this.plugin.saveSettings();
            this.display();
          });
      });
    new Setting(containerEl)
      .setName("Maximum edge thickness")
      .setDesc(
        "Set the thickness of the strongest visible relationship. All other edges are scaled proportionally from it using their raw evidence count.",
      )
      .addSlider((slider) => {
        slider
          .setLimits(1, 20, 0.5)
          .setValue(this.plugin.settings.maximumEdgeThickness)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maximumEdgeThickness = value;

            if (
              this.plugin.settings.minimumEdgeThickness > value
            ) {
              this.plugin.settings.minimumEdgeThickness = value;
            }

            await this.plugin.saveSettings();
            this.display();
          });
      });
    new Setting(containerEl)
      .setName("Rebuild index")
      .setDesc(
        "Discard the incremental index and rescan all Markdown notes.",
      )
      .addButton((button) => {
        button
          .setButtonText("Rebuild")
          .setCta()
          .onClick(async () => {
            await this.plugin.rebuildRelationshipIndex();
          });
      });
  }
  private async setRuleEnabled(
    ruleId: string,
    enabled: boolean,
  ): Promise<void> {
    const enabledRules = new Set(
      this.plugin.settings.enabledRuleIds,
    );
    if (enabled) {
      enabledRules.add(ruleId);
    } else {
      enabledRules.delete(ruleId);
    }
    this.plugin.settings.enabledRuleIds =
      Array.from(enabledRules);
    await this.plugin.saveSettings();
  }
}