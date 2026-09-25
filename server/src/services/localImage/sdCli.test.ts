import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSdCliArgs, resolveLocalImageConfig, runLocalImage } from "./sdCli.js";

const originalHome = process.env.LOCAL_IMAGE_HOME;
afterEach(() => {
  process.env.LOCAL_IMAGE_HOME = originalHome;
});

function fakeSdCli(script: string): string {
  const home = mkdtempSync(join(tmpdir(), "local-image-test-"));
  mkdirSync(join(home, "bin"));
  writeFileSync(join(home, "bin", "sd-cli"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(home, "bin", "sd-cli"), 0o755);
  process.env.LOCAL_IMAGE_HOME = home;
  return home;
}

describe("resolveLocalImageConfig", () => {
  it("defaults to Z-Image-Turbo at 512px, 8 steps, cfg 1.0 — the measured-practical setting", () => {
    const c = resolveLocalImageConfig({ LOCAL_IMAGE_HOME: "/h" });
    expect(c).toMatchObject({
      model: "z-image-turbo",
      sdCli: "/h/bin/sd-cli",
      diffusionModel: "/h/models/z_image_turbo-Q4_K.gguf",
      vae: "/h/models/flux_ae.safetensors",
      llm: "/h/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      steps: 8,
      size: 512,
      cfgScale: 1.0,
    });
  });

  it("switches every file and default to Qwen-Image-2.1 when asked", () => {
    const c = resolveLocalImageConfig({ LOCAL_IMAGE_HOME: "/h", LOCAL_IMAGE_MODEL: "qwen-image-2.1" });
    expect(c).toMatchObject({
      model: "qwen-image-2.1",
      diffusionModel: "/h/models/qwen-image-2.1-Q4_K_M.gguf",
      llm: "/h/models/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf",
      steps: 12,
      cfgScale: 6.0,
    });
  });

  it("falls back to Z-Image-Turbo for an unknown model name rather than failing", () => {
    expect(resolveLocalImageConfig({ LOCAL_IMAGE_MODEL: "nope" }).model).toBe("z-image-turbo");
  });
});

describe("buildSdCliArgs", () => {
  it("passes the prompt as a single argv entry and always keeps the memory flags", () => {
    const prompt = 'a cat"; rm -rf ~ #$(whoami)';
    const args = buildSdCliArgs(resolveLocalImageConfig({ LOCAL_IMAGE_HOME: "/q" }), prompt, "/tmp/o.png");

    expect(args[args.indexOf("-p") + 1]).toBe(prompt);
    expect(args.slice(args.indexOf("-o"))).toEqual(["-o", "/tmp/o.png"]);
    expect(args[args.indexOf("--params-backend") + 1]).toBe("te=disk");
    expect(args[args.indexOf("--max-vram") + 1]).toBe("7");
    expect(args).toContain("--vae-tiling");
  });
});

describe("runLocalImage", () => {
  it("returns the PNG sd-cli wrote to the -o path", async () => {
    const home = fakeSdCli('while [ "$1" != "-o" ]; do shift; done; printf PNG > "$2"');
    try {
      expect((await runLocalImage("a cat", 10_000)).toString()).toBe("PNG");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps the prompt out of the error it reports on failure", async () => {
    const home = fakeSdCli('echo "prompt: $*" >&2; exit 3');
    try {
      const err = await runLocalImage("my secret birthday surprise", 10_000).catch((e) => e as Error);
      expect(err.message).toContain("exit 3");
      expect(err.message).not.toContain("secret birthday");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
