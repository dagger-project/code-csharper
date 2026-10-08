// Running the dotnet CLI: MSBuild property queries and builds as editor tasks.
import { execFile } from "node:child_process";
import * as vscode from "vscode";

export function dotnetPath(): string {
  const configured = vscode.workspace.getConfiguration("codeCsharper").get<string>("dotnetPath") ?? "";
  return configured === "" ? "dotnet" : configured;
}

// `dotnet msbuild -getProperty:` evaluates the project without building it. With more than one
// property it prints {"Properties": {...}}.
export async function getProjectProperties(
  projectPath: string,
  names: readonly string[],
  properties: Readonly<Record<string, string>> = {},
): Promise<Record<string, string>> {
  const args = [
    "msbuild",
    projectPath,
    // Always two or more, so the output is JSON.
    ...[...names, "MSBuildProjectName"].map((name) => `-getProperty:${name}`),
    ...Object.entries(properties).map(([name, value]) => `-p:${name}=${value}`),
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(dotnetPath(), args, { maxBuffer: 16 * 1024 * 1024 }, (error, out) => {
      if (error) {
        reject(new Error(`dotnet msbuild failed for ${projectPath}: ${out === "" ? error.message : out}`));
      } else {
        resolve(out);
      }
    });
  });

  const parsed: unknown = JSON.parse(stdout);
  const result: Record<string, string> = {};
  if (typeof parsed === "object" && parsed !== null && "Properties" in parsed) {
    const { Properties: values } = parsed;
    if (typeof values === "object" && values !== null) {
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === "string") {
          result[name] = value;
        }
      }
    }
  }

  return result;
}

let taskCounter = 0;

// Runs `dotnet <args>` as an editor task, so its output shows in a terminal and compiler errors
// land in the Problems view. Resolves to whether it succeeded.
export async function runDotnetTask(
  name: string,
  args: readonly string[],
  folder: vscode.WorkspaceFolder | undefined,
  cwd: string,
): Promise<boolean> {
  const id = `${Date.now()}-${taskCounter++}`;
  const task = new vscode.Task(
    { type: "csharper", command: args[0] ?? "", id },
    folder ?? vscode.TaskScope.Workspace,
    name,
    "Code Csharper",
    new vscode.ProcessExecution(dotnetPath(), [...args], { cwd }),
    "$msCompile",
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent, clear: true };

  const finished = new Promise<boolean>((resolve) => {
    const listener = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.definition.id === id) {
        listener.dispose();
        resolve(event.exitCode === 0);
      }
    });
  });

  await vscode.tasks.executeTask(task);
  return finished;
}
