// Finds xUnit, NUnit, MSTest and TUnit tests in C# source without building: classes and the
// methods that carry a test attribute, with their lines, so the editor can show run and debug
// buttons next to them. Comments and string literals are blanked out first (keeping line breaks),
// then braces are counted to know which namespace and class each method is in.

export type DiscoveredMethod = {
  readonly name: string;
  readonly line: number;
};

export type DiscoveredClass = {
  // As test frameworks report it: namespace, then nested classes joined with "+".
  readonly fullName: string;
  readonly name: string;
  readonly line: number;
  readonly methods: DiscoveredMethod[];
};

const testAttribute =
  /^(?:Fact|Theory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod|SkippableFact|SkippableTheory|AvaloniaFact|AvaloniaTheory|StaFact|StaTheory|UIFact|UITheory)(?:Attribute)?$/u;
const typeDeclaration = /\b(?:class|struct|record(?:\s+class|\s+struct)?)\s+(@?\w+)/u;
const namespaceDeclaration = /^\s*namespace\s+([\w.]+)\s*(;)?/u;
const methodDeclaration = /^(?:[\w<>[\],.?\s]+\s)?(\w+)\s*(?:<[^()]*>)?\s*\(/u;

// Replaces comments and string/char literals with spaces; newlines are kept so lines line up.
function blank(text: string): string {
  return text.replaceAll(/[^\n]/gu, " ");
}

export function blankCommentsAndStrings(source: string): string {
  let result = "";
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index, index + 3);
    let end: number;
    if (rest.startsWith("//")) {
      end = source.indexOf("\n", index);
      end = end === -1 ? source.length : end;
    } else if (rest.startsWith("/*")) {
      end = source.indexOf("*/", index + 2);
      end = end === -1 ? source.length : end + 2;
    } else if (/^[$@]*"""/u.test(source.slice(index, index + 5))) {
      // Raw string literal: closed by as many quotes as opened it.
      const open = /^[$@]*("{3,})/u.exec(source.slice(index));
      const quotes = open?.[1] ?? '"""';
      const start = index + (open?.[0].length ?? 3);
      end = source.indexOf(quotes, start);
      end = end === -1 ? source.length : end + quotes.length;
    } else if (/^(?:\$@|@\$|@)"/u.test(rest)) {
      // Verbatim string: "" is an escaped quote.
      end = source.indexOf('"', index) + 1;
      while (end < source.length) {
        const close = source.indexOf('"', end);
        if (close === -1) {
          end = source.length;
          break;
        }

        if (source.charAt(close + 1) === '"') {
          end = close + 2;
        } else {
          end = close + 1;
          break;
        }
      }
    } else if (rest.startsWith('"') || rest.startsWith('$"') || rest.startsWith("'")) {
      const quote = rest.startsWith("'") ? "'" : '"';
      end = source.indexOf(quote, index) + 1;
      while (end < source.length && source.charAt(end) !== quote && source.charAt(end) !== "\n") {
        end += source.charAt(end) === "\\" ? 2 : 1;
      }

      end = Math.min(end + 1, source.length);
    } else {
      result += source.charAt(index);
      index++;
      continue;
    }

    result += blank(source.slice(index, end));
    index = end;
  }

  return result;
}

type Scope = { readonly kind: "namespace" | "class"; readonly name: string; readonly depth: number };

// Splits leading attribute lists ("[Fact]", "[TestCase(1, 2)]") off a line.
function takeAttributes(line: string): { names: string[]; rest: string } {
  const names: string[] = [];
  let rest = line.trimStart();
  while (rest.startsWith("[")) {
    let depth = 0;
    let end = 0;
    for (; end < rest.length; end++) {
      if (rest.charAt(end) === "[") {
        depth++;
      } else if (rest.charAt(end) === "]") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }

    // Attribute list continues on the next line: take what is there.
    const content = rest.slice(1, end);
    for (const attribute of content.split(",")) {
      const name = /^\s*(?:\w+\s*:\s*)?(?:[\w.]+\.)?(\w+)/u.exec(attribute)?.[1];
      if (name !== undefined) {
        names.push(name);
      }
    }

    rest = end < rest.length ? rest.slice(end + 1).trimStart() : "";
  }

  return { names, rest };
}

export function discoverTests(source: string): DiscoveredClass[] {
  const lines = blankCommentsAndStrings(source).split("\n");
  const classes = new Map<string, DiscoveredClass>();
  const scopes: Scope[] = [];
  let fileNamespace = "";
  let depth = 0;
  let pendingType: { name: string; line: number } | undefined;
  let pendingNamespace: string | undefined;
  let pendingTest = false;
  const classLines = new Map<string, number>();

  const currentClassName = (): string | undefined => {
    if (scopes.at(-1)?.kind !== "class") {
      return undefined;
    }

    const namespaces = [fileNamespace, ...scopes.filter((scope) => scope.kind === "namespace").map((scope) => scope.name)]
      .filter((name) => name !== "")
      .join(".");
    const types = scopes.filter((scope) => scope.kind === "class").map((scope) => scope.name).join("+");
    return namespaces === "" ? types : `${namespaces}.${types}`;
  };

  for (const [lineIndex, line] of lines.entries()) {
    const namespaceMatch = namespaceDeclaration.exec(line);
    if (namespaceMatch?.[1] !== undefined) {
      if (namespaceMatch[2] === ";") {
        fileNamespace = namespaceMatch[1];
      } else {
        pendingNamespace = namespaceMatch[1];
      }
    }

    const { names, rest } = takeAttributes(line);
    if (names.some((name) => testAttribute.test(name))) {
      pendingTest = true;
    }

    const typeMatch = typeDeclaration.exec(rest);
    if (typeMatch?.[1] !== undefined) {
      pendingType = { name: typeMatch[1].replace(/^@/u, ""), line: lineIndex };
      pendingTest = false;
    } else if (pendingTest && rest.trim() !== "") {
      const methodName = methodDeclaration.exec(rest)?.[1];
      const className = currentClassName();
      if (methodName !== undefined && className !== undefined) {
        let discovered = classes.get(className);
        if (!discovered) {
          discovered = {
            fullName: className,
            name: className.slice(Math.max(className.lastIndexOf("."), className.lastIndexOf("+")) + 1),
            line: classLines.get(className) ?? lineIndex,
            methods: [],
          };
          classes.set(className, discovered);
        }

        discovered.methods.push({ name: methodName, line: lineIndex });
      }

      pendingTest = false;
    }

    for (const char of line) {
      if (char === "{") {
        depth++;
        if (pendingType) {
          scopes.push({ kind: "class", name: pendingType.name, depth });
          const className = currentClassName();
          if (className !== undefined && !classLines.has(className)) {
            classLines.set(className, pendingType.line);
          }

          pendingType = undefined;
        } else if (pendingNamespace !== undefined) {
          scopes.push({ kind: "namespace", name: pendingNamespace, depth });
          pendingNamespace = undefined;
        }
      } else if (char === "}") {
        if (scopes.at(-1)?.depth === depth) {
          scopes.pop();
        }

        depth--;
      } else if (char === ";" && pendingType) {
        // record R(int X); has no body.
        pendingType = undefined;
      }
    }
  }

  return [...classes.values()];
}
