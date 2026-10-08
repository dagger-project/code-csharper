# Architecture

Code Csharper is a separate extension layered on the base C# extension, not a fork of it.
VS Code splits language support and debugging cleanly enough that none of the C# Dev Kit
features need changes to the base extension.

## The base C# extension

Each editor has its own C# extension, because Microsoft's debugger (`vsdbg`) may only be used in
Microsoft's products:

| Editor | Extension |
| --- | --- |
| VS Code | `ms-dotnettools.csharp` |
| Cursor | `anysphere.csharp` |
| VSCodium, Windsurf, other Open VSX editors | `muhammad-sammy.csharp` |

`extensionDependencies` only takes exact ids, so Code Csharper doesn't declare one. It finds the
installed extension at activation (`src/baseExtension.ts`) and offers to install the right one
for the editor when there is none.

Code Csharper doesn't use the base extension's API yet: launch profiles and tests work from the
project files, `launchSettings.json`, C# source and the dotnet CLI, so they behave the same with
every base extension.

## Projects

`src/projects.ts` finds the project files in the workspace and sorts them by reading their text
(no MSBuild evaluation): test projects reference a test framework or `Microsoft.NET.Test.Sdk`;
runnable projects have a `launchSettings.json`, `OutputType` `Exe`/`WinExe`, or a web, worker or
Aspire SDK. It rescans when project or `launchSettings.json` files change.

## Launch profiles

A launch target is a profile (`src/launchSettings.ts`) or a runnable project without profiles.

- Run: a `dotnet run --project … --launch-profile …` task, so `dotnet run` applies the profile.
- Debug: the `csharper` debug type (`src/launch.ts`) has no adapter of its own. Its
  configurations (`project`, `launchProfile`) are offered as dynamic configurations, which is how
  they appear in the Run and Debug dropdown. When one starts, its provider asks MSBuild for
  `TargetPath` (`dotnet msbuild -getProperty`), builds with a `dotnet build` task, and returns a
  `digger` or `coreclr` launch configuration built from the profile. VS Code resolves and launches
  that like any other. `launchBrowser` maps to VS Code's `serverReadyAction`, which works with any
  debugger.

`src/targetPicker.ts` keeps the selected target in workspace state and shows it in the status
bar.

## Tests

`src/testing/`:

- `discovery.ts` finds test classes and methods in C# source. It blanks out comments and string
  literals, then counts braces to track namespaces and (nested) classes. Full names follow the
  test frameworks: `Namespace.Outer+Inner.Method`.
- `controller.ts` is the VS Code test controller. Each run is one `dotnet test` per project, with
  a `FullyQualifiedName` filter for the chosen classes and methods and `--logger trx`.
  Data-driven cases share their method's `FullyQualifiedName` in all three frameworks, so an
  exact match runs them all. (NUnit rejects filters with escaped parentheses, so the filter
  avoids them.)
- `trx.ts` reads the TRX report and maps each result to `Namespace.Class.Method` through the
  report's class and method names.

Debugging sets `VSTEST_HOST_DEBUG=1` (and `VSTEST_DEBUG_NOBP=1` to skip its breakpoint): the test
host prints `Process Id: N` and waits; the controller attaches with the chosen debugger, which
lets the tests run.

## Debugging

The base extension owns the `coreclr` debug type. VS Code allows one debug adapter factory per
type, so Code Csharper never registers one for `coreclr`. Debugging goes through the `digger`
type that the Digger extension contributes; breakpoints are tied to languages, not debuggers, so
they reach Digger unchanged.

With `codeCsharper.useDiggerForCoreclr` on, a `coreclr` configuration provider retypes
configurations to `digger` before they start (`src/debugging.ts`). Launch and attach properties
the two share (`program`, `args`, `cwd`, `env`, `stopAtEntry`, `console`, `justMyCode`,
`sourceFileMap`, `processId`) carry over as they are.

## If a fork is ever needed

Use a patch queue, not a long-lived fork: upstream as a pinned submodule plus a small `patches/`
directory applied at build time (as VSCodium does with VS Code), with CI bumping the submodule
and checking that the patches still apply.
