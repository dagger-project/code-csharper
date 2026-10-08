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

Project features (solution explorer, test explorer, project-aware launch) will use the base
extension's exports: its Roslyn language server answers custom requests for opening solutions
and projects, project information and running tests.

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
