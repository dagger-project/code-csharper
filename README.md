# Code Csharper

> [!WARNING]
> **Code Csharper is at the very start of development.** Right now it only finds the C# extension
> and can route `coreclr` launch configurations to the Digger debugger.

An open-source alternative to C# Dev Kit: solution explorer, test explorer and project-aware
debugging for .NET, built on top of the base C# extension and debugging with
[Digger](https://github.com/dagger-project/digger). It works in VS Code and its forks (Cursor,
VSCodium, Windsurf).

## Requirements

- A C# language extension. Code Csharper uses whichever one the editor has, in this order:
  `ms-dotnettools.csharp` (VS Code), `anysphere.csharp` (Cursor), `muhammad-sammy.csharp`
  (Open VSX). If none is installed it offers to install the right one.
- For debugging, the Digger extension and `digger` itself (`dotnet tool install -g Digger.Debugger`).
  Digger runs on Linux and macOS; on Windows the base extension's debugger is used.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `codeCsharper.useDiggerForCoreclr` | `false` | Run `"type": "coreclr"` configurations with Digger, so existing `launch.json` files work unchanged |

## How it fits together

See [docs/architecture.md](docs/architecture.md).

## Development

Needs Node 24.

```sh
npm install
npm run check     # TypeScript 7 typecheck + oxlint (type-aware)
npm run build     # dist/extension.js
npm run package   # code-csharper-<version>.vsix
```

Press F5 in VS Code ("Run Extension") to start an Extension Development Host.

## License

[Apache 2.0](LICENSE)
