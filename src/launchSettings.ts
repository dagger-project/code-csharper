// Properties/launchSettings.json, as written by `dotnet new` and Visual Studio. The file is JSON
// with comments and trailing commas. Only the profile kinds we can start ourselves are kept:
// "Project" (the project's own program, what `dotnet run` does) and "Executable" (any program).
import { type ParseError, parse } from "jsonc-parser";

export type LaunchProfile = {
  readonly name: string;
  readonly commandName: "Project" | "Executable";
  readonly commandLineArgs: string | undefined;
  readonly workingDirectory: string | undefined;
  readonly executablePath: string | undefined;
  readonly environmentVariables: Readonly<Record<string, string>>;
  readonly applicationUrl: string | undefined;
  readonly launchBrowser: boolean;
  readonly launchUrl: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function parseLaunchSettings(text: string): LaunchProfile[] {
  const errors: ParseError[] = [];
  const root: unknown = parse(text, errors, { allowTrailingComma: true });
  if (!isRecord(root) || !isRecord(root.profiles)) {
    return [];
  }

  const profiles: LaunchProfile[] = [];
  for (const [name, value] of Object.entries(root.profiles)) {
    if (!isRecord(value) || (value.commandName !== "Project" && value.commandName !== "Executable")) {
      continue;
    }

    const environmentVariables: Record<string, string> = {};
    if (isRecord(value.environmentVariables)) {
      for (const [key, variable] of Object.entries(value.environmentVariables)) {
        if (typeof variable === "string") {
          environmentVariables[key] = variable;
        }
      }
    }

    profiles.push({
      name,
      commandName: value.commandName,
      commandLineArgs: optionalString(value.commandLineArgs),
      workingDirectory: optionalString(value.workingDirectory),
      executablePath: optionalString(value.executablePath),
      environmentVariables,
      applicationUrl: optionalString(value.applicationUrl),
      launchBrowser: value.launchBrowser === true,
      launchUrl: optionalString(value.launchUrl),
    });
  }

  return profiles;
}

// commandLineArgs is a single string; split it the way the .NET runtime splits a command line:
// whitespace separates arguments, double quotes group, and a backslash escapes a quote.
export function splitCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let inArgument = false;
  let quoted = false;
  for (let index = 0; index < commandLine.length; index++) {
    const char = commandLine.charAt(index);
    if (char === "\\" && commandLine.charAt(index + 1) === '"') {
      current += '"';
      inArgument = true;
      index++;
    } else if (char === '"') {
      quoted = !quoted;
      inArgument = true;
    } else if (!quoted && /\s/u.test(char)) {
      if (inArgument) {
        args.push(current);
        current = "";
        inArgument = false;
      }
    } else {
      current += char;
      inArgument = true;
    }
  }

  if (inArgument) {
    args.push(current);
  }

  return args;
}

// Visual Studio expands MSBuild-style $(ProjectDir) and $(TargetDir) (both with a trailing
// separator) and %VARIABLE% environment references in workingDirectory and commandLineArgs.
export function expandLaunchMacros(
  value: string,
  macros: Readonly<Record<string, string>>,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return value
    .replaceAll(/\$\((\w+)\)/gu, (match, name: string) => macros[name] ?? match)
    .replaceAll(/%(\w+)%/gu, (match, name: string) => environment[name] ?? match);
}
