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

// What activate returns; the end-to-end tests use it to look inside.
export type CodeCsharperApi = {
  readonly projects: ProjectIndex;
  readonly picker: TargetPicker;
  readonly tests: TestExplorer;
};

export async function activate(context: vscode.ExtensionContext): Promise<CodeCsharperApi> {
  const log = vscode.window.createOutputChannel("Code Csharper", { log: true });
  const projects = new ProjectIndex();
  const picker = new TargetPicker(projects, context.workspaceState);
  const tests = new TestExplorer(projects);
  context.subscriptions.push(log, projects, picker, tests);

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
  if (base) {
    log.info(`Using C# extension ${base.id}.`);
  } else {
    log.warn("No C# extension found.");
    // Not awaited: activation mustn't wait for someone to answer the notification.
    void offerToInstallBaseExtension();
  }

  return { projects, picker, tests };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
