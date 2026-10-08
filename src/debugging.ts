// Debugging goes through the Digger extension's "digger" debug type. The base C# extension owns
// "coreclr", and VS Code allows one adapter factory per type, so we never register one for it.
// With codeCsharper.useDiggerForCoreclr on, we instead retype coreclr configurations to "digger"
// before they start; VS Code then resolves and launches them as Digger sessions.
import * as vscode from "vscode";

export const diggerExtensionId = "digger.digger";

export function isDiggerInstalled(): boolean {
  return vscode.extensions.getExtension(diggerExtensionId) !== undefined;
}

function useDiggerForCoreclr(folder: vscode.WorkspaceFolder | undefined): boolean {
  return vscode.workspace.getConfiguration("codeCsharper", folder).get<boolean>("useDiggerForCoreclr", false);
}

class CoreclrToDiggerProvider implements vscode.DebugConfigurationProvider {
  public resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration {
    // Digger doesn't run on Windows yet; leave those sessions to the base extension.
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
