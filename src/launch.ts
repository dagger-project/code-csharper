// Launch targets: a launchSettings.json profile, or a runnable project without profiles. They can
// be run (`dotnet run`, in a terminal) or debugged (built, then started under the debugger).
//
// Debugging goes through the "csharper" debug type, which has no adapter of its own: its
// configurations ({ project, launchProfile }) are listed in the Run and Debug view's dropdown and
// can be saved in launch.json; when one starts we build the project and turn it into a "digger"
// (or "coreclr") configuration, which VS Code then resolves and launches.
import * as path from "node:path";
import * as vscode from "vscode";
import { debugType } from "./debugging.ts";
import { dotnetPath, getProjectProperties, runDotnetTask } from "./dotnet.ts";
import { type LaunchProfile, expandLaunchMacros, splitCommandLine } from "./launchSettings.ts";
import type { DotnetProject, ProjectIndex } from "./projects.ts";

export type LaunchTarget = {
  readonly id: string;
  readonly project: DotnetProject;
  readonly profile: LaunchProfile | undefined;
};

export function launchTargets(projects: ProjectIndex): LaunchTarget[] {
  return projects.ofKind("runnable").flatMap((project): LaunchTarget[] =>
    project.profiles.length === 0
      ? [{ id: project.path, project, profile: undefined }]
      : project.profiles.map((profile) => ({ id: `${project.path}#${profile.name}`, project, profile })),
  );
}

export function targetLabel(target: LaunchTarget): string {
  return target.profile ? `${target.project.name}: ${target.profile.name}` : target.project.name;
}

// What the "csharper" debug type takes.
type CsharperConfiguration = vscode.DebugConfiguration & {
  project?: unknown;
  launchProfile?: unknown;
};

function debugConfiguration(target: LaunchTarget): CsharperConfiguration {
  const project = target.project.folder
    ? `\${workspaceFolder}/${path.relative(target.project.folder.uri.fsPath, target.project.path).replaceAll("\\", "/")}`
    : target.project.path;
  return {
    type: "csharper",
    request: "launch",
    name: targetLabel(target),
    project,
    ...(target.profile ? { launchProfile: target.profile.name } : {}),
  };
}

export function debugTarget(target: LaunchTarget, noDebug = false): Thenable<boolean> {
  return vscode.debug.startDebugging(target.project.folder, debugConfiguration(target), { noDebug });
}

export async function runTarget(target: LaunchTarget): Promise<void> {
  const { project, profile } = target;
  let execution: vscode.ProcessExecution;
  if (profile?.commandName === "Executable") {
    if (profile.executablePath === undefined) {
      void vscode.window.showErrorMessage(`Launch profile "${profile.name}" has no executablePath.`);
      return;
    }

    const macros = { ProjectDir: project.dir + path.sep };
    const expand = (value: string): string => expandLaunchMacros(value, macros, process.env);
    execution = new vscode.ProcessExecution(
      expand(profile.executablePath),
      splitCommandLine(expand(profile.commandLineArgs ?? "")),
      {
        cwd: expand(profile.workingDirectory ?? project.dir),
        env: { ...profile.environmentVariables },
      },
    );
  } else {
    // `dotnet run` applies the profile itself (arguments, environment, URLs).
    const args = ["run", "--project", project.path, ...(profile ? ["--launch-profile", profile.name] : ["--no-launch-profile"])];
    execution = new vscode.ProcessExecution(dotnetPath(), args, { cwd: project.dir });
  }

  const task = new vscode.Task(
    { type: "csharper", command: "run", id: target.id },
    project.folder ?? vscode.TaskScope.Workspace,
    `Run ${targetLabel(target)}`,
    "Code Csharper",
    execution,
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: false, clear: true };
  await vscode.tasks.executeTask(task);
}

function resolveProjectPath(value: string, folder: vscode.WorkspaceFolder | undefined): string {
  const substituted = folder ? value.replaceAll("${workspaceFolder}", folder.uri.fsPath) : value;
  return path.resolve(folder?.uri.fsPath ?? "", substituted);
}

class CsharperConfigurationProvider implements vscode.DebugConfigurationProvider {
  public constructor(
    private readonly projects: ProjectIndex,
    private readonly selected: () => LaunchTarget | undefined,
  ) {}

  // The Run and Debug view's dropdown lists one entry per launch target.
  public provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return launchTargets(this.projects).map(debugConfiguration);
  }

  public async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: CsharperConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    // VS Code passes a configuration through every provider registered for its type in turn;
    // once one has turned it into a digger or coreclr configuration, there is nothing left to do.
    // (F5 without a launch.json passes an empty configuration, type included.)
    const type: unknown = config.type;
    if (typeof type === "string" && type !== "" && type !== "csharper") {
      return config;
    }

    let target: LaunchTarget | undefined;
    if (typeof config.project === "string") {
      const projectPath = resolveProjectPath(config.project, folder);
      const project = this.projects.find(projectPath);
      if (!project) {
        void vscode.window.showErrorMessage(`No .NET project at ${projectPath}.`);
        return undefined;
      }

      const profile =
        typeof config.launchProfile === "string"
          ? project.profiles.find((candidate) => candidate.name === config.launchProfile)
          : undefined;
      if (typeof config.launchProfile === "string" && !profile) {
        void vscode.window.showErrorMessage(`${project.name} has no launch profile "${config.launchProfile}".`);
        return undefined;
      }

      target = { id: profile ? `${project.path}#${profile.name}` : project.path, project, profile };
    } else {
      // F5 with no launch.json: the selected target.
      target = this.selected();
      if (!target) {
        void vscode.window.showErrorMessage("Select a launch profile first (Code Csharper: Select Launch Profile).");
        return undefined;
      }
    }

    const resolved = await prepareLaunch(target, config.noDebug === true);
    // The rest of the user's configuration (justMyCode, stopAtEntry, ...) goes to the debugger.
    const { project: _project, launchProfile: _launchProfile, ...rest } = config;
    return resolved ? { ...rest, ...resolved, name: config.name === "" ? targetLabel(target) : config.name } : undefined;
  }
}

// Builds the project and returns a launch configuration for the debugger.
async function prepareLaunch(target: LaunchTarget, noDebug: boolean): Promise<vscode.DebugConfiguration | undefined> {
  const { project, profile } = target;

  let properties = await getProjectProperties(project.path, ["TargetPath", "TargetFramework", "TargetFrameworks"], {
    Configuration: "Debug",
  });
  let framework = properties.TargetFramework ?? "";
  if (framework === "") {
    // Multi-targeted: like `dotnet run`, ask which framework.
    const frameworks = (properties.TargetFrameworks ?? "").split(";").filter((value) => value !== "");
    const picked =
      frameworks.length <= 1 ? frameworks[0] : await vscode.window.showQuickPick(frameworks, { placeHolder: "Target framework" });
    if (picked === undefined) {
      return undefined;
    }

    framework = picked;
    properties = await getProjectProperties(project.path, ["TargetPath"], { Configuration: "Debug", TargetFramework: framework });
  }

  const built = await runDotnetTask(
    `Build ${project.name}`,
    ["build", project.path, "--configuration", "Debug", "--framework", framework],
    project.folder,
    project.dir,
  );
  if (!built) {
    void vscode.window.showErrorMessage(`Building ${project.name} failed.`);
    return undefined;
  }

  const targetPath = properties.TargetPath ?? "";
  const macros = { ProjectDir: project.dir + path.sep, TargetDir: path.dirname(targetPath) + path.sep };
  const expand = (value: string): string => expandLaunchMacros(value, macros, process.env);

  const env: Record<string, string> = { ...profile?.environmentVariables };
  // `dotnet run` passes applicationUrl to ASP.NET Core this way.
  if (profile?.applicationUrl !== undefined && env.ASPNETCORE_URLS === undefined) {
    env.ASPNETCORE_URLS = profile.applicationUrl;
  }

  const configuration: vscode.DebugConfiguration = {
    type: debugType(project.folder),
    request: "launch",
    name: targetLabel(target),
    program: profile?.commandName === "Executable" && profile.executablePath !== undefined ? expand(profile.executablePath) : targetPath,
    args: splitCommandLine(expand(profile?.commandLineArgs ?? "")),
    // ASP.NET Core looks for appsettings.json and wwwroot in the working directory.
    cwd: expand(profile?.workingDirectory ?? project.dir),
    env,
    console: vscode.workspace.getConfiguration("codeCsharper", project.folder).get<string>("console", "internalConsole"),
    noDebug,
  };

  if (profile?.launchBrowser === true) {
    // VS Code's built-in server-ready support works with any debugger: it watches the debug
    // output for ASP.NET Core's "Now listening on:" line and opens the browser.
    const launchUrl = profile.launchUrl ?? "";
    configuration.serverReadyAction = /^https?:/u.test(launchUrl)
      ? { action: "openExternally", pattern: String.raw`\bNow listening on:\s+https?://\S+`, uriFormat: launchUrl }
      : {
          action: "openExternally",
          pattern: String.raw`\bNow listening on:\s+(https?://\S+)`,
          uriFormat: launchUrl === "" ? "%s" : `%s/${launchUrl}`,
        };
  }

  return configuration;
}

export function registerLaunching(
  context: vscode.ExtensionContext,
  projects: ProjectIndex,
  selected: () => LaunchTarget | undefined,
): void {
  // Registered once: every registration's resolveDebugConfiguration runs, whatever its trigger
  // kind. Dynamic is what lists the targets in the Run and Debug view's dropdown.
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "csharper",
      new CsharperConfigurationProvider(projects, selected),
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
  );
}
