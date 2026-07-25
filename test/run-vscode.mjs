import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionTestsPath = path.join(projectRoot, "test", "vscode", "index.js");

if (!process.env.OLLAMA_API_KEY?.trim()) {
  throw new Error("OLLAMA_API_KEY is required for the VS Code smoke test");
}

await runTests({
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath,
  launchArgs: [
    "--disable-extensions",
    "--disable-workspace-trust",
    projectRoot,
  ],
});
