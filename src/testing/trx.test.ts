import assert from "node:assert/strict";
import { test } from "node:test";
import { classFilter, methodFilter, parseTrx, resultKey, stackTraceLocation } from "./trx.ts";

test("result keys from each framework's naming", () => {
  assert.equal(resultKey("Ns.Cart", "Ns.Cart.Adds(count: 1)"), "Ns.Cart.Adds");
  assert.equal(resultKey("Ns.Cart", "Adds(1)"), "Ns.Cart.Adds");
  assert.equal(resultKey("Ns.Cart", "Adds (1)"), "Ns.Cart.Adds");
  assert.equal(resultKey("Ns.Outer+Inner", "Works"), "Ns.Outer+Inner.Works");
});

test("filters escape VSTest's special characters", () => {
  assert.equal(classFilter("Ns.Cart"), "FullyQualifiedName~Ns.Cart.");
  assert.equal(methodFilter("Ns.Cart.Adds"), "FullyQualifiedName=Ns.Cart.Adds");
  assert.equal(methodFilter("Ns.C.M(x)"), "FullyQualifiedName=Ns.C.M\\(x\\)");
});

test("stack trace locations", () => {
  assert.deepEqual(stackTraceLocation("   at Ns.Cart.Adds() in /src/CartTests.cs:line 42\n"), { file: "/src/CartTests.cs", line: 42 });
  assert.equal(stackTraceLocation("   at Ns.Cart.Adds()"), undefined);
});

test("parses results and failures", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="a" testName="Ns.Cart.Adds(count: 1)" outcome="Passed" duration="00:00:00.0100000" />
    <UnitTestResult testId="b" testName="Ns.Cart.Fails" outcome="Failed" duration="00:00:01.5000000">
      <Output>
        <StdOut>hello</StdOut>
        <ErrorInfo><Message>Assert.Equal() Failure &lt;1&gt;</Message><StackTrace>at Ns.Cart.Fails() in /src/Cart.cs:line 9</StackTrace></ErrorInfo>
      </Output>
    </UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest id="a" name="Ns.Cart.Adds(count: 1)"><TestMethod className="Ns.Cart" name="Adds" /></UnitTest>
    <UnitTest id="b" name="Ns.Cart.Fails"><TestMethod className="Ns.Cart" name="Fails" /></UnitTest>
  </TestDefinitions>
</TestRun>`;
  const [passed, failed] = parseTrx(xml);
  assert.equal(passed?.key, "Ns.Cart.Adds");
  assert.equal(passed.outcome, "passed");
  assert.equal(passed.durationMs, 10);
  assert.equal(failed?.outcome, "failed");
  assert.equal(failed.message, "Assert.Equal() Failure <1>");
  assert.equal(failed.output, "hello");
  assert.equal(failed.durationMs, 1500);
});
