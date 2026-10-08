import assert from "node:assert/strict";
import { test } from "node:test";
import { blankCommentsAndStrings, discoverTests } from "./discovery.ts";

test("finds xUnit facts and theories in a file-scoped namespace", () => {
  const source = `using Xunit;

namespace Shop.Tests;

public class CartTests
{
    [Fact]
    public void Empty_cart_costs_nothing() { }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task Adds_items(int count) { }

    public void Helper() { }
}
`;
  assert.deepEqual(discoverTests(source), [
    {
      fullName: "Shop.Tests.CartTests",
      name: "CartTests",
      line: 4,
      methods: [
        { name: "Empty_cart_costs_nothing", line: 7 },
        { name: "Adds_items", line: 12 },
      ],
    },
  ]);
});

test("joins nested classes with + and handles block namespaces", () => {
  const source = `namespace Outer
{
    namespace Inner
    {
        [TestFixture]
        public class Parser
        {
            public class WhenEmpty
            {
                [Test] public void Returns_nothing() { }
                [TestCase("}")] public void Ignores_braces_in_strings(string s) { }
            }
        }
    }
}
`;
  const [nested] = discoverTests(source);
  assert.equal(nested?.fullName, "Outer.Inner.Parser+WhenEmpty");
  assert.deepEqual(nested.methods.map((method) => method.name), ["Returns_nothing", "Ignores_braces_in_strings"]);
});

test("MSTest generic methods and attributes on one line", () => {
  const source = `namespace N;
[TestClass]
public sealed class MathTests
{
    [TestMethod, Timeout(1000)]
    public void Generic<T>() { }

    [DataTestMethod]
    [DataRow(1, 2)]
    public void Adds(int a, int b) { }
}
`;
  assert.deepEqual(discoverTests(source)[0]?.methods.map((method) => method.name), ["Generic", "Adds"]);
});

test("comments and strings don't confuse brace counting", () => {
  const source = `namespace N;
public class A
{
    // [Fact] public void Commented() { }
    private const string S = "{ [Fact] }";
    private const string V = @"
{";
    private const string R = """
        }
        """;
    /* { */
    [Fact] public void Real() { }
}
`;
  const [found] = discoverTests(source);
  assert.deepEqual(found?.methods.map((method) => method.name), ["Real"]);
  assert.equal(blankCommentsAndStrings(source).split("\n").length, source.split("\n").length);
});

test("classes without tests are left out", () => {
  assert.deepEqual(discoverTests("namespace N; public class Plain { public void M() { } }"), []);
});
