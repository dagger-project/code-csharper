// Starts an editor with Code Csharper and the Digger extension in development mode, opens
// test/fixture and runs test/e2e/suite.ts inside it.
//
//   npm run test:e2e                                               downloads VS Code
//   CODE_EXECUTABLE=test/e2e/codium-flatpak.sh npm run test:e2e    the Flatpak VSCodium
//
// DIGGER_EXTENSION_PATH points at Digger's editors/vscode (default: ../Digger beside this repo),
// DIGGER_PATH at the digger to use (default: the Digger extension's lookup).
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(import.meta.dirname, "../..");
const diggerExtension = process.env.DIGGER_EXTENSION_PATH ?? path.resolve(root, "../Digger/editors/vscode");
const state = path.join(root, ".vscode-test");

try {
  await runTests({
    ...(process.env.CODE_EXECUTABLE === undefined ? {} : { vscodeExecutablePath: path.resolve(process.env.CODE_EXECUTABLE) }),
    extensionDevelopmentPath: [root, diggerExtension],
    extensionTestsPath: path.join(root, "dist-test", "suite.js"),
    extensionTestsEnv: {
      CODE_CSHARPER_E2E_LOG: path.join(state, "e2e.log"),
      // A digger to test with other than the installed one (the Digger extension reads it).
      ...(process.env.DIGGER_PATH === undefined ? {} : { DIGGER_PATH: path.resolve(process.env.DIGGER_PATH) }),
    },
    launchArgs: [
      path.join(root, "test", "fixture"),
      `--user-data-dir=${path.join(state, "user-data")}`,
      `--extensions-dir=${path.join(state, "extensions")}`,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
