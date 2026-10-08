// The .NET projects in the workspace, sorted into the ones you run, the test projects and the rest.
// Kept up to date as project files and launchSettings.json files change.
import * as path from "node:path";
import * as vscode from "vscode";
import { type LaunchProfile, parseLaunchSettings } from "./launchSettings.ts";

export type ProjectKind = "runnable" | "test" | "library";

export type DotnetProject = {
  readonly uri: vscode.Uri;
  // The project file's path and its folder, both absolute.
  readonly path: string;
  readonly dir: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly folder: vscode.WorkspaceFolder | undefined;
  readonly profiles: readonly LaunchProfile[];
};

const projectGlob = "**/*.{csproj,fsproj,vbproj}";
const excludeGlob = "**/{bin,obj,node_modules,.git}/**";

// Judged from the project file's text, without evaluating MSBuild: good enough to pick which
// projects to offer for running and which to look for tests in.
export function classifyProject(text: string, hasLaunchSettings: boolean): ProjectKind {
  const isTest =
    /<IsTestProject>\s*true\s*</iu.test(text) ||
    /Sdk="MSTest\.Sdk/iu.test(text) ||
    /Include="(?:Microsoft\.NET\.Test\.Sdk|xunit(?:\.v3)?|NUnit|MSTest(?:\.TestFramework)?|TUnit)"/iu.test(text);
  if (isTest) {
    return "test";
  }

  const isRunnable =
    hasLaunchSettings ||
    /<OutputType>\s*(?:Win)?Exe\s*</iu.test(text) ||
    /Sdk="(?:Microsoft\.NET\.Sdk\.(?:Web|Worker|BlazorWebAssembly)|Aspire\.AppHost\.Sdk)/iu.test(text);
  return isRunnable ? "runnable" : "library";
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function loadProject(uri: vscode.Uri): Promise<DotnetProject | undefined> {
  const text = await readText(uri);
  if (text === undefined) {
    return undefined;
  }

  const dir = path.dirname(uri.fsPath);
  const launchSettings = await readText(vscode.Uri.file(path.join(dir, "Properties", "launchSettings.json")));
  return {
    uri,
    path: uri.fsPath,
    dir,
    name: path.basename(uri.fsPath, path.extname(uri.fsPath)),
    kind: classifyProject(text, launchSettings !== undefined),
    folder: vscode.workspace.getWorkspaceFolder(uri),
    profiles: launchSettings === undefined ? [] : parseLaunchSettings(launchSettings),
  };
}

export class ProjectIndex implements vscode.Disposable {
  private projects: DotnetProject[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private refreshTimer: NodeJS.Timeout | undefined;

  public readonly onDidChange = this.changed.event;

  public constructor() {
    for (const glob of [projectGlob, "**/Properties/launchSettings.json"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(glob);
      watcher.onDidCreate(() => this.scheduleRefresh(), undefined, this.disposables);
      watcher.onDidChange(() => this.scheduleRefresh(), undefined, this.disposables);
      watcher.onDidDelete(() => this.scheduleRefresh(), undefined, this.disposables);
      this.disposables.push(watcher);
    }

    vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh(), undefined, this.disposables);
  }

  public get all(): readonly DotnetProject[] {
    return this.projects;
  }

  public ofKind(kind: ProjectKind): DotnetProject[] {
    return this.projects.filter((project) => project.kind === kind);
  }

  public find(projectPath: string): DotnetProject | undefined {
    return this.projects.find((project) => project.path === projectPath);
  }

  // The project whose folder holds this file (the innermost one, for nested projects).
  public owning(filePath: string): DotnetProject | undefined {
    let best: DotnetProject | undefined;
    for (const project of this.projects) {
      if (filePath.startsWith(project.dir + path.sep) && (!best || project.dir.length > best.dir.length)) {
        best = project;
      }
    }

    return best;
  }

  public async refresh(): Promise<void> {
    const uris = await vscode.workspace.findFiles(projectGlob, excludeGlob);
    const loaded = await Promise.all(uris.map(loadProject));
    this.projects = loaded
      .filter((project) => project !== undefined)
      .toSorted((a, b) => a.name === b.name ? a.path.localeCompare(b.path) : a.name.localeCompare(b.name));
    this.changed.fire();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 300);
  }

  public dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
