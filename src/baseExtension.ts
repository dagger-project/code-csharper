// Code Csharper builds on whichever C# extension the editor ships or the user installed. Each
// editor has its own (Microsoft's debugger may only be used in Microsoft's products), so
// package.json can't name one in extensionDependencies; we look for them at run time instead.
import * as vscode from "vscode";

export type BaseExtension = {
  readonly id: string;
  readonly extension: vscode.Extension<unknown>;
};

// Most preferred first: VS Code's (Marketplace), Cursor's, and Open VSX's (VSCodium, Windsurf, ...).
export const knownBaseExtensionIds = ["ms-dotnettools.csharp", "anysphere.csharp", "muhammad-sammy.csharp"] as const;

export function findBaseExtension(): BaseExtension | undefined {
  for (const id of knownBaseExtensionIds) {
    const extension = vscode.extensions.getExtension(id);
    if (extension) {
      return { id, extension };
    }
  }

  return undefined;
}

// The extension the current editor can install from its own gallery.
function installableBaseExtensionId(): string {
  if (vscode.env.appName.toLowerCase().includes("cursor")) {
    return "anysphere.csharp";
  }

  return vscode.env.uriScheme === "vscode" || vscode.env.uriScheme === "vscode-insiders"
    ? "ms-dotnettools.csharp"
    : "muhammad-sammy.csharp";
}

export async function offerToInstallBaseExtension(): Promise<void> {
  const id = installableBaseExtensionId();
  const install = "Install";
  const choice = await vscode.window.showWarningMessage(
    `Code Csharper needs a C# language extension. Install ${id}?`,
    install,
  );
  if (choice === install) {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", id);
  }
}
