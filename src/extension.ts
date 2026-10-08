import * as vscode from "vscode";
import { findBaseExtension, offerToInstallBaseExtension } from "./baseExtension";
import { diggerExtensionId, isDiggerInstalled, registerDebugging } from "./debugging";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Code Csharper", { log: true });
  context.subscriptions.push(log);

  registerDebugging(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("codeCsharper.showStatus", () => {
      const base = findBaseExtension();
      const lines = [
        `C# extension: ${base ? `${base.id} ${extensionVersion(base.extension)}` : "not installed"}`,
        `Digger extension: ${isDiggerInstalled() ? diggerExtensionId : "not installed"}`,
      ];
      void vscode.window.showInformationMessage(lines.join(" · "));
    }),
  );

  const base = findBaseExtension();
  if (!base) {
    log.warn("No C# extension found.");
    await offerToInstallBaseExtension();
    return;
  }

  log.info(`Using C# extension ${base.id}.`);
  // The base extension's exports (its Roslyn language server) back the project features to come.
  await base.extension.activate();
}

function extensionVersion(extension: vscode.Extension<unknown>): string {
  const packageJson: unknown = extension.packageJSON;
  if (typeof packageJson !== "object" || packageJson === null || !("version" in packageJson)) {
    return "";
  }

  return typeof packageJson.version === "string" ? packageJson.version : "";
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
