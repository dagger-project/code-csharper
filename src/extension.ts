import * as vscode from "vscode";
import { findBaseExtension, offerToInstallBaseExtension } from "./baseExtension.ts";
import { diggerExtensionId, isDiggerInstalled, registerDebugging } from "./debugging.ts";
import { registerLaunching } from "./launch.ts";
import { ProjectIndex } from "./projects.ts";
import { TargetPicker } from "./targetPicker.ts";
import { TestExplorer } from "./testing/controller.ts";

function extensionVersion(extension: vscode.Extension<unknown>): string {
  const packageJson: unknown = extension.packageJSON;
  if (typeof packageJson !== "object" || packageJson === null || !("version" in packageJson)) {
    return "";
  }

  return typeof packageJson.version === "string" ? packageJson.version : "";
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Code Csharper", { log: true });
  const projects = new ProjectIndex();
  const picker = new TargetPicker(projects, context.workspaceState);
  context.subscriptions.push(log, projects, picker, new TestExplorer(projects));

  registerDebugging(context);
  registerLaunching(context, projects, () => picker.selected);

  context.subscriptions.push(
    vscode.commands.registerCommand("codeCsharper.selectLaunchTarget", () => picker.pick()),
    vscode.commands.registerCommand("codeCsharper.runLaunchTarget", () => picker.runSelected()),
    vscode.commands.registerCommand("codeCsharper.debugLaunchTarget", () => picker.debugSelected()),
    vscode.commands.registerCommand("codeCsharper.showStatus", () => {
      const base = findBaseExtension();
      const lines = [
        `C# extension: ${base ? `${base.id} ${extensionVersion(base.extension)}` : "not installed"}`,
        `Digger extension: ${isDiggerInstalled() ? diggerExtensionId : "not installed"}`,
        `Projects: ${projects.all.length}`,
      ];
      void vscode.window.showInformationMessage(lines.join(" · "));
    }),
  );

  await projects.refresh();
  log.info(`Found ${projects.all.length} .NET projects.`);

  const base = findBaseExtension();
  if (!base) {
    log.warn("No C# extension found.");
    await offerToInstallBaseExtension();
    return;
  }

  log.info(`Using C# extension ${base.id}.`);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
