import assert from "node:assert/strict";
import { test } from "node:test";
import { expandLaunchMacros, parseLaunchSettings, splitCommandLine } from "./launchSettings.ts";

test("reads Project and Executable profiles from JSON with comments", () => {
  const profiles = parseLaunchSettings(`{
    // dotnet new web
    "profiles": {
      "https": {
        "commandName": "Project",
        "launchBrowser": true,
        "applicationUrl": "https://localhost:7001;http://localhost:5001",
        "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development", },
      },
      "IIS Express": { "commandName": "IISExpress" },
      "Tool": { "commandName": "Executable", "executablePath": "/usr/bin/env", "commandLineArgs": "a b" },
    },
  }`);
  assert.deepEqual(profiles.map((profile) => profile.name), ["https", "Tool"]);
  assert.equal(profiles[0]?.launchBrowser, true);
  assert.deepEqual(profiles[0]?.environmentVariables, { ASPNETCORE_ENVIRONMENT: "Development" });
  assert.equal(profiles[1]?.executablePath, "/usr/bin/env");
});

test("ignores files without profiles", () => {
  assert.deepEqual(parseLaunchSettings("{}"), []);
  assert.deepEqual(parseLaunchSettings("not json"), []);
});

test("splits command lines like the runtime", () => {
  assert.deepEqual(splitCommandLine(`--name "John Smith" -v  'x' \\"q\\" ""`), ["--name", "John Smith", "-v", "'x'", '"q"', ""]);
  assert.deepEqual(splitCommandLine("   "), []);
});

test("expands $(ProjectDir) and %VARIABLE%", () => {
  assert.equal(expandLaunchMacros("$(ProjectDir)data/%HOME%/$(Unknown)", { ProjectDir: "/p/" }, { HOME: "/h" }), "/p/data//h/$(Unknown)");
});
