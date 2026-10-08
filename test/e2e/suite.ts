// End-to-end tests, run inside the editor by test/e2e/run.mts with test/fixture open. They drive
// Code Csharper through the API its activate() returns and check what reaches the debugger and
// the test runs, using the real dotnet SDK and Digger.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CodeCsharperApi } from "../../src/extension.ts";
import { type LaunchTarget, debugTarget, launchTargets, runTarget } from "../../src/launch.ts";

const timeout = 240_000;
const logFile = process.env.CODE_CSHARPER_E2E_LOG;

function log(message: string): void {
  console.log(message);
  if (logFile !== undefined) {
    fs.appendFileSync(logFile, `${message}\n`);
  }
}

async function waitFor<T>(what: string, check: () => T | undefined, ms = timeout): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== undefined) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
}

const fixture = (): string => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test/fixture is open");
  return folder.uri.fsPath;
};

// Debug adapter traffic of every session, to see stops and program output.
type DapMessage = { type?: string; event?: string; body?: Record<string, unknown> };
const sessions: { session: vscode.DebugSession; messages: DapMessage[]; ended: boolean }[] = [];
vscode.debug.registerDebugAdapterTrackerFactory("*", {
  createDebugAdapterTracker(session) {
    const record = { session, messages: [] as DapMessage[], ended: false };
    sessions.push(record);
    return {
      onDidSendMessage: (message: DapMessage) => {
        record.messages.push(message);
      },
      onExit: () => {
        record.ended = true;
      },
    };
  },
});

function output(record: (typeof sessions)[number]): string {
  return record.messages
    .filter((message) => message.event === "output")
    .map((message) => (typeof message.body?.output === "string" ? message.body.output : ""))
    .join("");
}

function findStop(type: string): { session: vscode.DebugSession; threadId: number } | undefined {
  for (const record of sessions) {
    const stopped = record.messages.find((message) => message.event === "stopped");
    if (record.session.type === type && stopped && !record.ended) {
      return { session: record.session, threadId: Number(stopped.body?.threadId) };
    }
  }

  return undefined;
}

function waitForStop(type: string): Promise<{ session: vscode.DebugSession; threadId: number }> {
  return waitFor(`a ${type} session to stop`, () => findStop(type));
}

async function topFrame(session: vscode.DebugSession, threadId: number): Promise<{ id: number; line: number; file: string }> {
  const trace = (await session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 1 })) as {
    stackFrames: { id: number; line: number; source?: { path?: string } }[];
  };
  const [frame] = trace.stackFrames;
  assert.ok(frame, "a stack frame");
  return { id: frame.id, line: frame.line, file: frame.source?.path ?? "" };
}

async function evaluate(session: vscode.DebugSession, frameId: number, expression: string): Promise<string> {
  const result = (await session.customRequest("evaluate", { expression, frameId, context: "watch" })) as { result: string };
  return result.result;
}

function breakpointAt(file: string, marker: string): vscode.SourceBreakpoint {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const line = lines.findIndex((text) => text.includes(marker));
  assert.ok(line >= 0, `${marker} in ${file}`);
  return new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(file), new vscode.Position(line, 0)));
}

// Records what a run reports for each test item.
function recordResults(api: CodeCsharperApi): Map<string, string> {
  const results = new Map<string, string>();
  const { controller } = api.tests;
  const createTestRun = controller.createTestRun.bind(controller);
  controller.createTestRun = (request, name, persist) => {
    const testRun = createTestRun(request, name, persist);
    return new Proxy(testRun, {
      get(original, property, receiver) {
        const value: unknown = Reflect.get(original, property, receiver);
        if (typeof value !== "function") {
          return value;
        }

        return (...args: unknown[]) => {
          const [item] = args;
          if (typeof property === "string" && ["passed", "failed", "skipped", "errored"].includes(property) && item instanceof Object && "id" in item && typeof item.id === "string") {
            results.set(item.id, property);
          }

          return Reflect.apply(value, original, args) as unknown;
        };
      },
    });
  };
  return results;
}

function childLabelled(items: vscode.TestItemCollection, label: string): vscode.TestItem | undefined {
  const found: vscode.TestItem[] = [];
  items.forEach((candidate) => {
    if (candidate.label === label) {
      found.push(candidate);
    }
  });
  return found[0];
}

function testItem(api: CodeCsharperApi, ...labels: string[]): vscode.TestItem {
  let items = api.tests.controller.items;
  let item: vscode.TestItem | undefined;
  for (const label of labels) {
    item = childLabelled(items, label);
    assert.ok(item, `test item ${labels.join(" > ")}`);
    items = item.children;
  }

  assert.ok(item);
  return item;
}

async function runTests(api: CodeCsharperApi, profile: vscode.TestRunProfile, items: vscode.TestItem[]): Promise<void> {
  const cancellation = new vscode.CancellationTokenSource();
  await profile.runHandler(new vscode.TestRunRequest(items, undefined, profile), cancellation.token);
}

function target(api: CodeCsharperApi, project: string, profile: string): LaunchTarget {
  const found = launchTargets(api.projects).find((candidate) => candidate.project.name === project && candidate.profile?.name === profile);
  assert.ok(found, `launch target ${project}: ${profile}`);
  return found;
}

const tests: [string, (api: CodeCsharperApi) => Promise<void>][] = [
  [
    "finds runnable and test projects with their launch profiles",
    async (api) => {
      await Promise.resolve();
      assert.deepEqual(api.projects.ofKind("runnable").map((project) => project.name), ["Hello", "Web"]);
      assert.deepEqual(api.projects.ofKind("test").map((project) => project.name), ["MTests", "NTests", "XTests"]);
      assert.deepEqual(launchTargets(api.projects).map((candidate) => `${candidate.project.name}: ${candidate.profile?.name}`), [
        "Hello: Greet",
        "Hello: Plain",
        "Web: http",
        "Web: https",
      ]);
      assert.equal(api.picker.selected?.profile?.name, "Greet");
    },
  ],
  [
    "discovers tests from source, with locations",
    async (api) => {
      await waitFor("test discovery", () => (api.tests.controller.items.size === 3 ? true : undefined), 30_000);
      const passes = testItem(api, "XTests", "UnitTest1", "Passes");
      assert.equal(passes.range?.start.line, 5);
      testItem(api, "XTests", "UnitTest1", "Theory");
      testItem(api, "XTests", "Nested", "Skipped");
      testItem(api, "NTests", "Tests", "Cases");
      testItem(api, "MTests", "Test1", "Rows");
    },
  ],
  [
    "runs whole projects in each framework",
    async (api) => {
      const results = recordResults(api);
      await runTests(api, api.tests.runProfile, [testItem(api, "XTests"), testItem(api, "NTests"), testItem(api, "MTests")]);
      const outcome = (...names: string[]): string | undefined => results.get(testItem(api, ...names).id);
      assert.equal(outcome("XTests", "UnitTest1", "Passes"), "passed");
      assert.equal(outcome("XTests", "UnitTest1", "Fails"), "failed");
      assert.equal(outcome("XTests", "UnitTest1", "Theory"), "passed");
      assert.equal(outcome("XTests", "Nested", "Skipped"), "skipped");
      assert.equal(outcome("NTests", "Tests", "Passes"), "passed");
      assert.equal(outcome("NTests", "Tests", "Cases"), "failed");
      assert.equal(outcome("MTests", "Test1", "Passes"), "passed");
      assert.equal(outcome("MTests", "Test1", "Rows"), "failed");
    },
  ],
  [
    "runs a single test method",
    async (api) => {
      const results = recordResults(api);
      await runTests(api, api.tests.runProfile, [testItem(api, "XTests", "UnitTest1", "Passes")]);
      assert.deepEqual([...results.values()], ["passed"]);
    },
  ],
  [
    "debugs a test: stops at a breakpoint in it, then reports the result",
    async (api) => {
      const results = recordResults(api);
      const breakpoint = breakpointAt(path.join(fixture(), "XTests", "UnitTest1.cs"), "e2e: breakpoint");
      vscode.debug.addBreakpoints([breakpoint]);
      try {
        const done = runTests(api, api.tests.debugProfile, [testItem(api, "XTests", "UnitTest1", "Passes")]);
        const { session, threadId } = await waitForStop("digger");
        const frame = await topFrame(session, threadId);
        assert.equal(frame.line, breakpoint.location.range.start.line + 1);
        assert.equal(await evaluate(session, frame.id, "answer"), "42");
        await session.customRequest("continue", { threadId });
        await done;
        assert.equal(results.get(testItem(api, "XTests", "UnitTest1", "Passes").id), "passed");
      } finally {
        vscode.debug.removeBreakpoints([breakpoint]);
      }
    },
  ],
  [
    "debugs a launch profile with its arguments and environment",
    async (api) => {
      const breakpoint = breakpointAt(path.join(fixture(), "Hello", "Program.cs"), "e2e: breakpoint");
      vscode.debug.addBreakpoints([breakpoint]);
      const before = sessions.length;
      try {
        await debugTarget(target(api, "Hello", "Greet"));
        const { session, threadId } = await waitForStop("digger");
        const frame = await topFrame(session, threadId);
        assert.equal(path.basename(frame.file), "Program.cs");
        assert.match(await evaluate(session, frame.id, "message"), /Hi, John Smith!/u);
        await session.customRequest("continue", { threadId });
        const record = await waitFor("the program to finish", () => sessions.slice(before).find((candidate) => candidate.session.type === "digger" && candidate.ended));
        assert.match(output(record), new RegExp(`cwd=${path.join(fixture(), "Hello").replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
      } finally {
        vscode.debug.removeBreakpoints([breakpoint]);
      }
    },
  ],
  [
    "debugs the web project until ASP.NET Core listens on the profile's URL",
    async (api) => {
      const before = sessions.length;
      const web = target(api, "Web", "http");
      const url = web.profile?.applicationUrl;
      assert.ok(url !== undefined, "the http profile has an applicationUrl");
      assert.ok(await debugTarget(web), "the debug session starts");
      try {
        const record = await waitFor(
          "Now listening",
          () => sessions.slice(before).find((candidate) => candidate.session.type === "digger" && output(candidate).includes(`Now listening on: ${url}`)),
          60_000,
        );
        await vscode.debug.stopDebugging(record.session);
      } catch (error) {
        for (const record of sessions.slice(before)) {
          log(`    session ${record.session.type} ${record.session.name} ended=${record.ended}:\n${output(record)}`);
        }

        throw error;
      }
    },
  ],
  [
    "runs a launch profile with dotnet run",
    async (api) => {
      const exitCode = new Promise<number | undefined>((resolve) => {
        const listener = vscode.tasks.onDidEndTaskProcess((event) => {
          if (event.execution.task.name === "Run Hello: Greet") {
            listener.dispose();
            resolve(event.exitCode);
          }
        });
      });
      await runTarget(target(api, "Hello", "Greet"));
      assert.equal(await exitCode, 0);
    },
  ],
];

export async function run(): Promise<void> {
  if (logFile !== undefined) {
    fs.writeFileSync(logFile, "");
  }

  const extension = vscode.extensions.getExtension<CodeCsharperApi>("dagger-project.code-csharper");
  assert.ok(extension, "Code Csharper is loaded");
  const api = await extension.activate();
  await vscode.workspace.getConfiguration("codeCsharper").update("debugger", "digger", vscode.ConfigurationTarget.Workspace);

  let failures = 0;
  for (const [name, test] of tests) {
    const started = Date.now();
    try {
      await test(api);
      log(`✔ ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      failures++;
      log(`✖ ${name}\n    ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }

    await vscode.debug.stopDebugging();
  }

  log(`${tests.length - failures} passed, ${failures} failed`);
  if (failures > 0) {
    throw new Error(`${failures} end-to-end tests failed`);
  }
}
