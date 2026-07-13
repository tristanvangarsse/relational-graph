import { App, PluginSettingTab, Setting } from "obsidian";
import type WeightedRelationshipGraphPlugin from "./main";

export class WeightedRelationshipGraphSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WeightedRelationshipGraphPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Minimum relationship strength")
      .setDesc("Default minimum weighted strength shown in the graph toolbar.")
      .addSlider((slider) => slider
        .setLimits(0.1, 25, 0.1)
        .setValue(this.plugin.settings.minimumWeight)
        .onChange(async (value) => {
          this.plugin.settings.minimumWeight = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Initial layout duration")
      .setDesc("How long the graph layout runs after the graph loads.")
      .addSlider((slider) => slider
        .setLimits(1000, 15000, 1000)
        .setValue(this.plugin.settings.layoutDurationMs)
        .onChange(async (value) => {
          this.plugin.settings.layoutDurationMs = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Recency weighting")
      .setDesc("Reduce the influence of older relationship evidence.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.recencyEnabled)
        .onChange(async (value) => {
          this.plugin.settings.recencyEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Recency half-life")
      .setDesc("After this many days, an evidence item contributes half its original weight.")
      .addSlider((slider) => slider
        .setLimits(7, 730, 7)
        .setValue(this.plugin.settings.recencyHalfLifeDays)
        .onChange(async (value) => {
          this.plugin.settings.recencyHalfLifeDays = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Shared-context rule")
      .setDesc("Connect every pair of notes referenced by the same note.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enabledRuleIds.includes("shared-context"))
        .onChange(async (value) => this.setRuleEnabled("shared-context", value)));

    new Setting(containerEl)
      .setName("Direct-link rule")
      .setDesc("Connect a source note directly to every Markdown note it links to.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enabledRuleIds.includes("direct-link"))
        .onChange(async (value) => this.setRuleEnabled("direct-link", value)));

    new Setting(containerEl)
      .setName("Node size scale")
      .setDesc("Scale degree-based node sizing.")
      .addSlider((slider) => slider
        .setLimits(0.5, 2, 0.1)
        .setValue(this.plugin.settings.nodeSizeScale)
        .onChange(async (value) => {
          this.plugin.settings.nodeSizeScale = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Rebuild index")
      .setDesc("Discard the incremental index and rescan all Markdown notes.")
      .addButton((button) => button
        .setButtonText("Rebuild")
        .setCta()
        .onClick(async () => this.plugin.rebuildRelationshipIndex()));
  }

  private async setRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
    const next = new Set(this.plugin.settings.enabledRuleIds);
    if (enabled) next.add(ruleId);
    else next.delete(ruleId);
    this.plugin.settings.enabledRuleIds = Array.from(next);
    await this.plugin.saveSettings();
  }
}
