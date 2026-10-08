// Debugging goes through the Digger extension's "digger" debug type, or the base C# extension's
// "coreclr" where Digger isn't available. The base extension owns "coreclr", and VS Code allows
// one adapter factory per type, so we never register one for it. With
// codeCsharper.useDiggerForCoreclr on, we instead retype coreclr configurations to "digger"
// before they start; VS Code then resolves and launches them as Digger sessions.
import * as vscode from "vscode";

export const diggerExtensionId = "digger.digger";

export type DebugType = "digger" | "coreclr";

export function isDiggerInstalled(): boolean {
  return vscode.extensions.getExtension(diggerExtensionId) !== undefined;
}

// Digger doesn't run on Windows yet.
function canUseDigger(): boolean {
  return process.platform !== "win32" && isDiggerInstalled();
}

// The debugger for sessions Code Csharper starts (launch profiles and tests).
export function debugType(folder: vscode.WorkspaceFolder | undefined): DebugType {
  const setting = vscode.workspace.getConfiguration("codeCsharper", folder).get<string>("debugger", "auto");
  if (setting === "coreclr" || (setting === "auto" && !canUseDigger())) {
    return "coreclr";
  }

  if (!canUseDigger()) {
    void vscode.window.showWarningMessage(
      process.platform === "win32"
        ? "Digger doesn't support Windows yet; using the C# extension's debugger."
        : `codeCsharper.debugger is "digger", but the Digger extension (${diggerExtensionId}) is not installed. Using the C# extension's debugger.`,
    );
    return "coreclr";
  }

  return "digger";
}

function useDiggerForCoreclr(folder: vscode.WorkspaceFolder | undefined): boolean {
  return vscode.workspace.getConfiguration("codeCsharper", folder).get<boolean>("useDiggerForCoreclr", false);
}

class CoreclrToDiggerProvider implements vscode.DebugConfigurationProvider {
  public resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration {
    if (config.type !== "coreclr" || process.platform === "win32" || !useDiggerForCoreclr(folder)) {
      return config;
    }

    if (!isDiggerInstalled()) {
      void vscode.window.showWarningMessage(
        `codeCsharper.useDiggerForCoreclr is on, but the Digger extension (${diggerExtensionId}) is not installed. Using the default debugger.`,
      );
      return config;
    }

    // The launch and attach properties Digger shares with coreclr (program, args, cwd, env,
    // stopAtEntry, console, justMyCode, sourceFileMap, processId) carry over as they are.
    return { ...config, type: "digger" };
  }
}

export function registerDebugging(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("coreclr", new CoreclrToDiggerProvider()),
  );
}
