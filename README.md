# Code Csharper

> [!WARNING]
> **Code Csharper is at the very start of development.** Expect rough edges and changes.

Launch profiles and a Test Explorer for .NET in VS Code and its forks (Cursor, VSCodium,
Windsurf), built on top of the base C# extension and debugging with
[Digger](https://github.com/dagger-project/digger).

## Features

### Launch profiles

Code Csharper reads each project's `Properties/launchSettings.json`. Runnable projects without one
are offered as the project itself.

- **Status bar:** the selected profile (`$(rocket) Web: https`), with run and debug buttons next to it.
- **Select Launch Profile** (`Alt+Shift+F10`): every profile, grouped by project. Enter selects one;
  the ▷ and debug buttons on an entry start it straight away.
- **Run** uses `dotnet run --launch-profile`, in a terminal.
- **Debug** builds the project, then starts it under the debugger with the profile's arguments,
  working directory, environment variables and `applicationUrl`. With `launchBrowser`, the browser
  opens once ASP.NET Core reports it is listening.
- **Run and Debug view:** the dropdown lists every profile under "Code Csharper". To keep one in
  `launch.json`:

  ```json
  {
    "name": "Web: https",
    "type": "csharper",
    "request": "launch",
    "project": "${workspaceFolder}/src/Web/Web.csproj",
    "launchProfile": "https"
  }
  ```

  Leave out `project` to start whichever profile is selected in the status bar.

`Project` and `Executable` profiles are supported. `IISExpress` and `Docker` profiles are skipped.

### Test Explorer

Tests show up in the Testing view, grouped as project → class → method. Run and debug buttons
appear in the editor gutter next to each test class and method, and VS Code's own test commands
work too (for example `Ctrl+; C` runs the test at the cursor).

- **Discovery** reads the C# source of test projects (xUnit, NUnit, MSTest, TUnit attributes), so
  tests appear without building and update as you edit.
- **Running** uses `dotnet test --filter`. Results, failure messages with clickable stack-trace
  locations, durations and test output come from its TRX report. Data-driven tests (theories,
  test cases, data rows) report as one test, failed if any case failed.
- **Debugging** starts the test host waiting for a debugger and attaches to it.

Tests the source scan can't see (F# tests, tests inherited from a base class) appear once they
have run.

## Requirements

- The .NET SDK.
- A C# language extension. Code Csharper uses whichever one the editor has, in this order:
  `ms-dotnettools.csharp` (VS Code), `anysphere.csharp` (Cursor), `muhammad-sammy.csharp`
  (Open VSX). If none is installed it offers to install the right one.
- For debugging with Digger, the Digger extension and `digger` itself
  (`dotnet tool install -g Digger.Debugger`). Digger runs on Linux and macOS; elsewhere, or without
  it, the C# extension's debugger is used.

### Flatpak VSCodium

The Flatpak VSCodium runs in a sandbox that can't see a .NET SDK installed on the host. Give it
the .NET SDK extension:

```sh
flatpak install --user flathub org.freedesktop.Sdk.Extension.dotnet10//25.08
flatpak override --user --env=FLATPAK_ENABLE_SDK_EXT=dotnet10 com.vscodium.codium
```

`digger` from `dotnet tool install -g` lives in your home directory, which the sandbox can see.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `codeCsharper.debugger` | `auto` | Debugger for launch profiles and tests: `auto` (Digger when available), `digger` or `coreclr` |
| `codeCsharper.console` | `internalConsole` | Where debugged programs run: `internalConsole`, `integratedTerminal` (stdin works) or `externalTerminal` |
| `codeCsharper.dotnetPath` | | The `dotnet` executable; empty means `dotnet` on `PATH` |
| `codeCsharper.useDiggerForCoreclr` | `false` | Run `"type": "coreclr"` configurations with Digger, so existing `launch.json` files work unchanged |

## Known limitations

- Test projects that opt in to Microsoft.Testing.Platform mode for `dotnet test` (in `global.json`)
  aren't supported yet; the default VSTest mode is.
- Multi-targeted projects ask for a target framework when debugging.

## How it fits together

See [docs/architecture.md](docs/architecture.md).

## Development

Needs Node 24.

```sh
npm install
npm run check     # TypeScript 7 typecheck, oxlint (type-aware) and unit tests
npm run build     # dist/extension.js
npm run package   # code-csharper-<version>.vsix
```

Press F5 in VS Code ("Run Extension") to start an Extension Development Host.

### End-to-end tests

`npm run test:e2e` starts an editor with Code Csharper and the Digger extension (from
`../Digger/editors/vscode`), opens `test/fixture` (a console app, a web app, and xUnit, NUnit and
MSTest projects) and drives launch profiles and tests through the real dotnet SDK and Digger: it
checks discovery and results, stops at breakpoints in a test and in a program, and checks that a
profile's arguments, environment and URL reach the program.

```sh
npm run test:e2e                                                # downloads VS Code
CODE_EXECUTABLE=test/e2e/codium-flatpak.sh npm run test:e2e     # the Flatpak VSCodium
DIGGER_PATH=../Digger/artifacts/e2e-digger/digger npm run test:e2e   # a digger built from source
```

The editor opens a window while the tests run.

## Releasing

Bump `version` in `package.json`, commit, then tag and push:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The Release workflow checks the tag matches `package.json`, runs the checks, publishes the
`.vsix` to [Open VSX](https://open-vsx.org/extension/dagger-project/code-csharper) and attaches it
to a GitHub release. It needs an `OVSX_PAT` secret (an Open VSX access token with rights to the
`dagger-project` namespace) in the repository's `openvsx` environment.

## License

[Apache 2.0](LICENSE)
