// The selected launch target, like Rider's run configuration selector: shown in the status bar
// with run and debug buttons, picked from a list of every profile grouped by project.
import * as vscode from "vscode";
import { type LaunchTarget, debugTarget, launchTargets, runTarget, targetLabel } from "./launch.ts";
import type { ProjectIndex } from "./projects.ts";

const selectedKey = "codeCsharper.selectedTarget";

const runButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Run" };
const debugButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("debug-alt"), tooltip: "Debug" };

type TargetItem = vscode.QuickPickItem & { readonly target?: LaunchTarget };

export class TargetPicker implements vscode.Disposable {
  private readonly selector = vscode.window.createStatusBarItem("codeCsharper.target", vscode.StatusBarAlignment.Left, 50);
  private readonly run = vscode.window.createStatusBarItem("codeCsharper.run", vscode.StatusBarAlignment.Left, 49);
  private readonly debug = vscode.window.createStatusBarItem("codeCsharper.debug", vscode.StatusBarAlignment.Left, 48);
  private readonly subscription: vscode.Disposable;

  public constructor(
    private readonly projects: ProjectIndex,
    private readonly state: vscode.Memento,
  ) {
    this.selector.name = "Code Csharper: Launch Profile";
    this.selector.command = "codeCsharper.selectLaunchTarget";
    this.run.name = "Code Csharper: Run";
    this.run.text = "$(play)";
    this.run.tooltip = "Run the selected launch profile";
    this.run.command = "codeCsharper.runLaunchTarget";
    this.debug.name = "Code Csharper: Debug";
    this.debug.text = "$(debug-alt)";
    this.debug.tooltip = "Debug the selected launch profile";
    this.debug.command = "codeCsharper.debugLaunchTarget";
    this.subscription = projects.onDidChange(() => this.update());
    this.update();
  }

  public get selected(): LaunchTarget | undefined {
    const targets = launchTargets(this.projects);
    const id = this.state.get<string>(selectedKey);
    return targets.find((target) => target.id === id) ?? targets[0];
  }

  private async select(target: LaunchTarget): Promise<void> {
    await this.state.update(selectedKey, target.id);
    this.update();
  }

  private update(): void {
    const target = this.selected;
    const items = [this.selector, this.run, this.debug];
    if (!target) {
      for (const item of items) {
        item.hide();
      }

      return;
    }

    this.selector.text = `$(rocket) ${targetLabel(target)}`;
    this.selector.tooltip = "Select the launch profile to run or debug";
    for (const item of items) {
      item.show();
    }
  }

  // Pick a target; the run and debug buttons on each entry start it straight away.
  public pick(): Promise<LaunchTarget | undefined> {
    const targets = launchTargets(this.projects);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage("No runnable .NET projects in this workspace.");
      // oxlint-disable-next-line unicorn/no-useless-undefined -- resolve takes the value
      return Promise.resolve(undefined);
    }

    const selectedId = this.selected?.id;
    const items: TargetItem[] = [];
    let previousProject: string | undefined;
    for (const target of targets) {
      if (target.project.path !== previousProject) {
        items.push({ label: target.project.name, kind: vscode.QuickPickItemKind.Separator });
        previousProject = target.project.path;
      }

      const { profile } = target;
      items.push({
        label: `${target.id === selectedId ? "$(check)" : "$(blank)"} ${profile?.name ?? target.project.name}`,
        description: profile ? (profile.applicationUrl ?? profile.commandName) : "project",
        buttons: [runButton, debugButton],
        target,
      });
    }

    const quickPick = vscode.window.createQuickPick<TargetItem>();
    quickPick.items = items;
    quickPick.placeholder = "Select a launch profile";
    quickPick.matchOnDescription = true;
    const current = items.find((item) => item.target?.id === selectedId);
    if (current) {
      quickPick.activeItems = [current];
    }

    return new Promise<LaunchTarget | undefined>((resolve) => {
      let result: LaunchTarget | undefined;
      quickPick.onDidAccept(() => {
        result = quickPick.selectedItems[0]?.target;
        quickPick.hide();
      });
      quickPick.onDidTriggerItemButton(async (event) => {
        const { target } = event.item;
        if (!target) {
          return;
        }

        result = target;
        quickPick.hide();
        await (event.button === runButton ? runTarget(target) : debugTarget(target));
      });
      quickPick.onDidHide(async () => {
        quickPick.dispose();
        if (result) {
          await this.select(result);
        }

        resolve(result);
      });
      quickPick.show();
    });
  }

  public async runSelected(): Promise<void> {
    const target = this.selected ?? (await this.pick());
    if (target) {
      await runTarget(target);
    }
  }

  public async debugSelected(): Promise<void> {
    const target = this.selected ?? (await this.pick());
    if (target) {
      await debugTarget(target);
    }
  }

  public dispose(): void {
    this.subscription.dispose();
    this.selector.dispose();
    this.run.dispose();
    this.debug.dispose();
  }
}
