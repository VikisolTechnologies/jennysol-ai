import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSdCliArgs, resolveQwenImagePaths, resolveQwenImageSettings, runQwenImage } from "./qwenImageCli.js";

const originalHome = process.env.QWEN_IMAGE_HOME;
afterEach(() => {
  process.env.QWEN_IMAGE_HOME = originalHome;
});

function fakeSdCli(script: string): string {
  const home = mkdtempSync(join(tmpdir(), "qwen-image-test-"));
  mkdirSync(join(home, "bin"));
  writeFileSync(join(home, "bin", "sd-cli"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(home, "bin", "sd-cli"), 0o755);
  process.env.QWEN_IMAGE_HOME = home;
  return home;
}

describe("runQwenImage", () => {
  it("returns the PNG sd-cli wrote to the -o path", async () => {
    // Writes "PNG" to the argument after -o.
    const home = fakeSdCli('while [ "$1" != "-o" ]; do shift; done; printf PNG > "$2"');
    try {
      expect((await runQwenImage("a cat", 10_000)).toString()).toBe("PNG");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps the prompt out of the error it reports on failure", async () => {
    const home = fakeSdCli('echo "prompt: $*" >&2; exit 3');
    try {
      const err = await runQwenImage("my secret birthday surprise", 10_000).catch((e) => e as Error);
      expect(err.message).toContain("exit 3");
      expect(err.message).not.toContain("secret birthday");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("qwenImageCli", () => {
  it("resolves every file under QWEN_IMAGE_HOME", () => {
    const paths = resolveQwenImagePaths({ QWEN_IMAGE_HOME: "/opt/qi" });
    expect(paths).toEqual({
      sdCli: "/opt/qi/bin/sd-cli",
      diffusionModel: "/opt/qi/models/qwen-image-2.1-Q4_K_M.gguf",
      vae: "/opt/qi/models/qwen_image_2.1_vae_bf16.safetensors",
      llm: "/opt/qi/models/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf",
    });
  });

  it("defaults to the settings measured as practical on the M1 Pro", () => {
    expect(resolveQwenImageSettings({})).toEqual({ steps: 12, size: 512, cfgScale: 6.0 });
  });

  it("passes the prompt as a single argv entry, so shell metacharacters stay inert", () => {
    const prompt = 'a cat"; rm -rf ~ #$(whoami)';
    const args = buildSdCliArgs(resolveQwenImagePaths({ QWEN_IMAGE_HOME: "/q" }), resolveQwenImageSettings({}), prompt, "/tmp/o.png");

    expect(args[args.indexOf("-p") + 1]).toBe(prompt);
    expect(args.slice(args.indexOf("-o"))).toEqual(["-o", "/tmp/o.png"]);
    expect(args).toContain("--diffusion-fa");
    expect(args.slice(args.indexOf("--params-backend"), args.indexOf("--params-backend") + 2)).toEqual(["--params-backend", "te=disk"]);
  });
});
