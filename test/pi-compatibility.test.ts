import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const parentPath = join(packageRoot, "pi-extension/subagents/index.ts");
const childPath = join(packageRoot, "pi-extension/subagents/subagent-done.ts");

async function loadTools(path: string, installed = false) {
  const dir = mkdtempSync(join(tmpdir(), "subagent-pi-compat-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: join(dir, "agent"),
      settingsManager: SettingsManager.inMemory(installed ? { packages: [packageRoot] } : {}),
      additionalExtensionPaths: [path],
      noExtensions: !installed,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const { errors, extensions } = loader.getExtensions();
    assert.deepEqual(errors, [], "file-based extension loading must succeed");
    assert.equal(extensions.length, 1, "the same entrypoint must only load once");
    return new Map([...extensions[0].tools].map(([name, tool]) => [name, tool.definition]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Pi file-based extension compatibility", () => {
  it("loads the parent with Pi's loader and validates its tool arguments", async () => {
    const tools = await loadTools(parentPath);
    assert.deepEqual([...tools.keys()].sort(), [
      "subagent", "subagent_interrupt", "subagent_resume", "subagents_list",
    ]);
    const schema = tools.get("subagent")!.parameters;
    assert.ok(Value.Check(schema, { name: "Worker", task: "Review the code" }));
    assert.ok(Value.Check(schema, {
      name: "Worker", task: "Review the code", thinking: "high", fork: true,
    }));
    assert.equal(Value.Check(schema, { task: "Missing name" }), false);
    assert.equal(Value.Check(schema, { name: "Worker", task: "Review", thinking: "invalid" }), false);
    assert.equal(Value.Check(schema, { name: "Worker", task: "Review", fork: "true" }), false);
  });

  it("loads the child extension and validates its control tools", async () => {
    const tools = await loadTools(childPath);
    assert.deepEqual([...tools.keys()].sort(), ["caller_ping", "subagent_done"]);
    assert.ok(Value.Check(tools.get("subagent_done")!.parameters, {}));
    const schema = tools.get("caller_ping")!.parameters;
    assert.ok(Value.Check(schema, { message: "Need clarification" }));
    assert.equal(Value.Check(schema, {}), false);
  });

  it("deduplicates a local package also loaded explicitly during development", async () => {
    const tools = await loadTools(parentPath, true);
    assert.ok(tools.has("subagent"));
  });
});
