// Results of a `dotnet test` run, from the TRX (Visual Studio test results) files that
// `--logger trx` writes. Every framework's VSTest adapter fills in the test's class and method,
// which is what we match against the discovered tests.
import { XMLParser } from "fast-xml-parser";

export type TestOutcome = "passed" | "failed" | "skipped";

export type TrxResult = {
  // "Namespace.Class.Method", nested classes joined with "+".
  readonly key: string;
  readonly displayName: string;
  readonly outcome: TestOutcome;
  readonly durationMs: number | undefined;
  readonly message: string | undefined;
  readonly stackTrace: string | undefined;
  readonly output: string | undefined;
};

type XmlNode = Record<string, unknown>;

function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(node: unknown, name: string): XmlNode | undefined {
  if (!isNode(node)) {
    return undefined;
  }

  const value = node[name];
  return isNode(value) ? value : undefined;
}

function children(node: unknown, name: string): XmlNode[] {
  if (!isNode(node)) {
    return [];
  }

  const value = node[name];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function text(node: unknown, name: string): string | undefined {
  if (!isNode(node)) {
    return undefined;
  }

  const value = node[name];
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return isNode(value) && typeof value["#text"] === "string" ? value["#text"] : undefined;
}

// "00:00:01.2345678" → milliseconds.
function parseDuration(duration: string | undefined): number | undefined {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/u.exec(duration ?? "");
  if (!match) {
    return undefined;
  }

  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000;
}

const passedOutcomes = new Set(["Passed", "PassedButRunAborted", "Warning"]);
const skippedOutcomes = new Set(["NotExecuted", "Inconclusive", "NotRunnable", "Pending"]);

function outcomeOf(outcome: string | undefined): TestOutcome {
  if (outcome !== undefined && passedOutcomes.has(outcome)) {
    return "passed";
  }

  return outcome !== undefined && skippedOutcomes.has(outcome) ? "skipped" : "failed";
}

// xUnit names results "Namespace.Class.Method(x: 1)", NUnit "Method(1)", MSTest "Method (1)".
export function resultKey(className: string, testName: string): string {
  let method = testName.replace(/\s*\(.*$/su, "");
  if (method.startsWith(`${className}.`)) {
    method = method.slice(className.length + 1);
  }

  method = method.slice(method.lastIndexOf(".") + 1);
  return `${className}.${method}`;
}

export function parseTrx(xml: string): TrxResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name) => name === "UnitTest" || name === "UnitTestResult",
  });
  const document: unknown = parser.parse(xml);
  const run = child(document, "TestRun");

  const classNames = new Map<string, string>();
  for (const unitTest of children(child(run, "TestDefinitions"), "UnitTest")) {
    const id = text(unitTest, "@id");
    const className = text(child(unitTest, "TestMethod"), "@className");
    if (id !== undefined && className !== undefined) {
      classNames.set(id, className);
    }
  }

  const results: TrxResult[] = [];
  for (const result of children(child(run, "Results"), "UnitTestResult")) {
    const testName = text(result, "@testName") ?? "";
    const className = classNames.get(text(result, "@testId") ?? "") ?? "";
    const output = child(result, "Output");
    const errorInfo = child(output, "ErrorInfo");
    results.push({
      key: resultKey(className, testName),
      displayName: testName,
      outcome: outcomeOf(text(result, "@outcome")),
      durationMs: parseDuration(text(result, "@duration")),
      message: text(errorInfo, "Message"),
      stackTrace: text(errorInfo, "StackTrace"),
      output: text(output, "StdOut"),
    });
  }

  return results;
}

// VSTest filter values escape these with a backslash.
function escapeFilterValue(value: string): string {
  return value.replaceAll(/[\\()&|=!~]/gu, (char) => `\\${char}`);
}

export function classFilter(fullName: string): string {
  return `FullyQualifiedName~${escapeFilterValue(`${fullName}.`)}`;
}

// Data-driven cases (xUnit theories, NUnit test cases, MSTest data rows) share the method's
// FullyQualifiedName, so an exact match runs all of them.
export function methodFilter(fullName: string): string {
  return `FullyQualifiedName=${escapeFilterValue(fullName)}`;
}

// "at Ns.Class.Method() in /src/Tests.cs:line 42" → the first frame with a file.
export function stackTraceLocation(stackTrace: string): { file: string; line: number } | undefined {
  const match = / in (.+?):line (\d+)/u.exec(stackTrace);
  return match?.[1] === undefined ? undefined : { file: match[1], line: Number(match[2]) };
}
