// The Test Explorer: tests found in the source of each test project (project → class → method),
// with run and debug buttons in the editor gutter. Tests run with `dotnet test --filter`, and
// results come back from its TRX report. To debug, the test host is started waiting for a
// debugger (VSTEST_HOST_DEBUG), and we attach to it once it prints its process id.
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { debugType } from "../debugging.ts";
import { dotnetPath } from "../dotnet.ts";
import type { DotnetProject, ProjectIndex } from "../projects.ts";
import { discoverTests } from "./discovery.ts";
import { type TrxResult, classFilter, methodFilter, parseTrx, stackTraceLocation } from "./trx.ts";

type ItemKind = "project" | "class" | "method";

type ItemData = {
  readonly kind: ItemKind;
  readonly project: DotnetProject;
  // Class or method full name; empty for projects.
  readonly fullName: string;
};

const sourceExclude = "**/{bin,obj}/**";

export class TestExplorer implements vscode.Disposable {
  private readonly controller = vscode.tests.createTestController("codeCsharper", ".NET Tests");
  private readonly data = new WeakMap<vscode.TestItem, ItemData>();
  private readonly disposables: vscode.Disposable[] = [this.controller];
  private readonly pendingProjects = new Set<string>();
  private discoverTimer: NodeJS.Timeout | undefined;

  public constructor(private readonly projects: ProjectIndex) {
    this.controller.refreshHandler = () => projects.refresh();
    this.controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token, false), true);
    this.controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, (request, token) => this.run(request, token, true), true);

    projects.onDidChange(() => void this.discoverAll(), undefined, this.disposables);
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.cs");
    const changed = (uri: vscode.Uri): void => this.scheduleDiscovery(uri.fsPath);
    watcher.onDidCreate(changed, undefined, this.disposables);
    watcher.onDidChange(changed, undefined, this.disposables);
    watcher.onDidDelete(changed, undefined, this.disposables);
    this.disposables.push(watcher);
  }

  private async discoverAll(): Promise<void> {
    const testProjects = this.projects.ofKind("test");
    const ids = new Set(testProjects.map((project) => project.path));
    this.controller.items.forEach((item) => {
      if (!ids.has(item.id)) {
        this.controller.items.delete(item.id);
      }
    });

    await Promise.all(testProjects.map((project) => this.discoverProject(project)));
  }

  private scheduleDiscovery(filePath: string): void {
    const project = this.projects.owning(filePath);
    if (project?.kind !== "test") {
      return;
    }

    this.pendingProjects.add(project.path);
    clearTimeout(this.discoverTimer);
    this.discoverTimer = setTimeout(() => {
      const pending = [...this.pendingProjects];
      this.pendingProjects.clear();
      for (const projectPath of pending) {
        const pendingProject = this.projects.find(projectPath);
        if (pendingProject) {
          void this.discoverProject(pendingProject);
        }
      }
    }, 300);
  }

  private createItem(kind: ItemKind, project: DotnetProject, id: string, label: string, fullName: string, uri?: vscode.Uri): vscode.TestItem {
    const item = this.controller.createTestItem(id, label, uri);
    this.data.set(item, { kind, project, fullName });
    return item;
  }

  private async discoverProject(project: DotnetProject): Promise<void> {
    const pattern = new vscode.RelativePattern(project.dir, "**/*.cs");
    const files = await vscode.workspace.findFiles(pattern, sourceExclude);

    const projectItem =
      this.controller.items.get(project.path) ?? this.createItem("project", project, project.path, project.name, "", project.uri);
    const classes = new Map<string, vscode.TestItem>();
    for (const file of files.toSorted((a, b) => a.fsPath.localeCompare(b.fsPath))) {
      // Files of a nested project belong to that project.
      if (this.projects.owning(file.fsPath)?.path !== project.path) {
        continue;
      }

      let source: string;
      try {
        source = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
      } catch {
        continue;
      }

      for (const discovered of discoverTests(source)) {
        let classItem = classes.get(discovered.fullName);
        if (!classItem) {
          classItem = this.createItem("class", project, `${project.path}::${discovered.fullName}`, discovered.name, discovered.fullName, file);
          classItem.range = new vscode.Range(discovered.line, 0, discovered.line, 0);
          classItem.description = discovered.fullName.slice(0, -discovered.name.length - 1);
          classes.set(discovered.fullName, classItem);
        }

        for (const method of discovered.methods) {
          const fullName = `${discovered.fullName}.${method.name}`;
          const methodItem = this.createItem("method", project, `${project.path}::${fullName}`, method.name, fullName, file);
          methodItem.range = new vscode.Range(method.line, 0, method.line, 0);
          classItem.children.add(methodItem);
        }
      }
    }

    projectItem.children.replace([...classes.values()].toSorted((a, b) => a.label.localeCompare(b.label)));
    this.controller.items.add(projectItem);
  }

  private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean): Promise<void> {
    const run = this.controller.createTestRun(request);
    const excluded = new Set(request.exclude?.map((item) => item.id));

    // What to run, grouped by project.
    const byProject = new Map<string, { project: DotnetProject; items: vscode.TestItem[] }>();
    const requested: vscode.TestItem[] = [];
    if (request.include) {
      requested.push(...request.include);
    } else {
      this.controller.items.forEach((item) => requested.push(item));
    }

    for (const item of requested) {
      const data = this.data.get(item);
      if (!data || excluded.has(item.id)) {
        continue;
      }

      const group = byProject.get(data.project.path) ?? { project: data.project, items: [] };
      group.items.push(item);
      byProject.set(data.project.path, group);
    }

    try {
      for (const { project, items } of byProject.values()) {
        if (token.isCancellationRequested) {
          break;
        }

        await this.runProject(run, project, items, excluded, token, debug);
      }
    } finally {
      run.end();
    }
  }

  // The methods under these items, in the run.
  private methodsOf(items: readonly vscode.TestItem[], excluded: ReadonlySet<string>): Map<string, vscode.TestItem> {
    const methods = new Map<string, vscode.TestItem>();
    const visit = (item: vscode.TestItem): void => {
      if (excluded.has(item.id)) {
        return;
      }

      const data = this.data.get(item);
      if (data?.kind === "method") {
        methods.set(data.fullName, item);
      }

      item.children.forEach(visit);
    };
    for (const item of items) {
      visit(item);
    }

    return methods;
  }

  private filterFor(items: readonly vscode.TestItem[], excluded: ReadonlySet<string>): string | undefined {
    const parts: string[] = [];
    for (const item of items) {
      const data = this.data.get(item);
      if (!data || data.kind === "project") {
        // The whole project, unless some tests are excluded.
        if (excluded.size === 0) {
          return undefined;
        }

        return [...this.methodsOf([item], excluded).keys()].map(methodFilter).join("|");
      }

      if (data.kind === "class" && ![...excluded].some((id) => id.startsWith(`${item.id}.`))) {
        parts.push(classFilter(data.fullName));
      } else {
        parts.push(...[...this.methodsOf([item], excluded).keys()].map(methodFilter));
      }
    }

    return parts.join("|");
  }

  private async runProject(
    run: vscode.TestRun,
    project: DotnetProject,
    items: readonly vscode.TestItem[],
    excluded: ReadonlySet<string>,
    token: vscode.CancellationToken,
    debug: boolean,
  ): Promise<void> {
    const methods = this.methodsOf(items, excluded);
    for (const item of methods.values()) {
      run.started(item);
    }

    const resultsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "code-csharper-"));
    const args = ["test", project.path, "--logger", "trx", "--results-directory", resultsDirectory];
    const filter = this.filterFor(items, excluded);
    if (filter !== undefined) {
      args.push("--filter", filter);
    }

    run.appendOutput(`> dotnet ${args.join(" ")}\r\n`);
    const exitCode = await this.runDotnetTest(run, project, args, token, debug);

    let results: TrxResult[] = [];
    try {
      for (const file of await fs.readdir(resultsDirectory)) {
        if (file.endsWith(".trx")) {
          results.push(...parseTrx(await fs.readFile(path.join(resultsDirectory, file), "utf8")));
        }
      }
    } catch {
      results = [];
    } finally {
      await fs.rm(resultsDirectory, { recursive: true, force: true });
    }

    if (results.length === 0) {
      const message = new vscode.TestMessage(
        token.isCancellationRequested ? "Cancelled." : `dotnet test exited with code ${exitCode ?? "?"} without results; see the test output.`,
      );
      for (const item of methods.values()) {
        run.errored(item, message);
      }

      return;
    }

    this.report(run, project, methods, results);
  }

  private report(run: vscode.TestRun, project: DotnetProject, methods: Map<string, vscode.TestItem>, results: readonly TrxResult[]): void {
    const byKey = new Map<string, TrxResult[]>();
    for (const result of results) {
      byKey.set(result.key, [...(byKey.get(result.key) ?? []), result]);
    }

    for (const [key, keyResults] of byKey) {
      // Tests the source scan missed (F#, inherited tests, custom attributes): add them as they report.
      const item = methods.get(key) ?? this.addReportedTest(project, key);
      const durationMs = keyResults.reduce((total, result) => total + (result.durationMs ?? 0), 0);
      const failures = keyResults.filter((result) => result.outcome === "failed");
      for (const result of keyResults) {
        if (result.output !== undefined) {
          run.appendOutput(result.output.replaceAll(/\r?\n/gu, "\r\n"), undefined, item);
        }
      }

      if (failures.length > 0) {
        run.failed(item, failures.map((failure) => this.failureMessage(failure, keyResults.length > 1)), durationMs);
      } else if (keyResults.every((result) => result.outcome === "skipped")) {
        run.skipped(item);
      } else {
        run.passed(item, durationMs);
      }

      methods.delete(key);
    }

    // Asked for but not reported: the filter didn't match (renamed, not compiled, ...).
    for (const item of methods.values()) {
      run.skipped(item);
    }
  }

  private failureMessage(result: TrxResult, showName: boolean): vscode.TestMessage {
    const text = [showName ? result.displayName : undefined, result.message, result.stackTrace].filter((part) => part !== undefined).join("\n");
    const message = new vscode.TestMessage(text);
    const location = result.stackTrace === undefined ? undefined : stackTraceLocation(result.stackTrace);
    if (location) {
      message.location = new vscode.Location(vscode.Uri.file(location.file), new vscode.Position(Math.max(location.line - 1, 0), 0));
    }

    return message;
  }

  private addReportedTest(project: DotnetProject, key: string): vscode.TestItem {
    const projectItem = this.controller.items.get(project.path) ?? this.createItem("project", project, project.path, project.name, "", project.uri);
    this.controller.items.add(projectItem);
    const className = key.slice(0, key.lastIndexOf("."));
    const classId = `${project.path}::${className}`;
    let classItem = projectItem.children.get(classId);
    if (!classItem) {
      const name = className.slice(Math.max(className.lastIndexOf("."), className.lastIndexOf("+")) + 1);
      classItem = this.createItem("class", project, classId, name, className);
      projectItem.children.add(classItem);
    }

    const methodItem = this.createItem("method", project, `${project.path}::${key}`, key.slice(key.lastIndexOf(".") + 1), key);
    classItem.children.add(methodItem);
    return methodItem;
  }

  private async runDotnetTest(
    run: vscode.TestRun,
    project: DotnetProject,
    args: readonly string[],
    token: vscode.CancellationToken,
    debug: boolean,
  ): Promise<number | null> {
    const env: NodeJS.ProcessEnv = { ...process.env, DOTNET_CLI_UI_LANGUAGE: "en" };
    if (debug) {
      // The test host prints its process id and waits for a debugger; NOBP skips its Debugger.Break().
      Object.assign(env, { VSTEST_HOST_DEBUG: "1", VSTEST_DEBUG_NOBP: "1" });
    }

    const child = spawn(dotnetPath(), args, { cwd: project.dir, env });
    let session: vscode.DebugSession | undefined;
    let attaching = false;
    let pending = "";
    const onOutput = (chunk: Buffer): void => {
      const text = chunk.toString();
      run.appendOutput(text.replaceAll(/\r?\n/gu, "\r\n"));
      if (!debug || attaching) {
        return;
      }

      pending += text;
      const processId = /Process Id:\s*(\d+)/u.exec(pending)?.[1];
      if (processId !== undefined) {
        attaching = true;
        void this.attach(project, Number(processId), run).then((started) => {
          session = started;
          return started ?? child.kill();
        });
      }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    const cancellation = token.onCancellationRequested(() => child.kill());

    try {
      return await new Promise<number | null>((resolve) => {
        child.on("error", (error) => {
          run.appendOutput(`${error.message}\r\n`);
          resolve(null);
        });
        child.on("close", resolve);
      });
    } finally {
      cancellation.dispose();
      if (session) {
        await vscode.debug.stopDebugging(session);
      }
    }
  }

  private async attach(project: DotnetProject, processId: number, run: vscode.TestRun): Promise<vscode.DebugSession | undefined> {
    const name = `Debug tests: ${project.name}`;
    const started = new Promise<vscode.DebugSession | undefined>((resolve) => {
      const listener = vscode.debug.onDidStartDebugSession((session) => {
        if (session.name === name) {
          listener.dispose();
          resolve(session);
        }
      });
      setTimeout(() => {
        listener.dispose();
        // oxlint-disable-next-line unicorn/no-useless-undefined -- resolve takes the value
        resolve(undefined);
      }, 30_000);
    });

    const ok = await vscode.debug.startDebugging(
      project.folder,
      { type: debugType(project.folder), request: "attach", name, processId },
      { testRun: run, suppressDebugToolbar: false },
    );
    return ok ? started : undefined;
  }

  public dispose(): void {
    clearTimeout(this.discoverTimer);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
