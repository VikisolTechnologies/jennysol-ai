import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Local text-to-image through stable-diffusion.cpp's sd-cli. Measured on the
// M1 Pro 16GB, 2026-09-25, same prompt:
//   z-image-turbo   512px 1m35s, 1024px 7m14s — Apache 2.0 (commercial OK)
//   qwen-image-2.1  512px 5m16s, 1024px 32.6min — Qwen Research License,
//                   non-commercial only (JENNY_MODEL_LICENSE_MATRIX.md)
export type LocalImageModel = "z-image-turbo" | "qwen-image-2.1";

interface Preset {
  diffusionModel: string;
  vae: string;
  llm: string;
  steps: number;
  cfgScale: number;
  extraArgs: string[];
}

// Both keep the text encoder's weights on disk and cap GPU memory at 7GB:
// without that, Qwen-Image-2.1 ran Metal out of memory at step 9/20, and
// Z-Image-Turbo ran out while decoding the final image.
const PRESETS: Record<LocalImageModel, Preset> = {
  "z-image-turbo": {
    diffusionModel: "z_image_turbo-Q4_K.gguf",
    vae: "flux_ae.safetensors",
    llm: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    steps: 8,
    cfgScale: 1.0,
    extraArgs: ["--vae-tiling"],
  },
  "qwen-image-2.1": {
    diffusionModel: "qwen-image-2.1-Q4_K_M.gguf",
    vae: "qwen_image_2.1_vae_bf16.safetensors",
    llm: "Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf",
    steps: 12,
    cfgScale: 6.0,
    extraArgs: ["--sampling-method", "euler"],
  },
};

export interface LocalImageConfig {
  model: LocalImageModel;
  sdCli: string;
  diffusionModel: string;
  vae: string;
  llm: string;
  steps: number;
  size: number;
  cfgScale: number;
  extraArgs: string[];
}

export function resolveLocalImageConfig(env: NodeJS.ProcessEnv = process.env): LocalImageConfig {
  const model: LocalImageModel = env.LOCAL_IMAGE_MODEL === "qwen-image-2.1" ? "qwen-image-2.1" : "z-image-turbo";
  const preset = PRESETS[model];
  const home = env.LOCAL_IMAGE_HOME || join(homedir(), ".jennysol", "image");
  return {
    model,
    sdCli: join(home, "bin", "sd-cli"),
    diffusionModel: join(home, "models", preset.diffusionModel),
    vae: join(home, "models", preset.vae),
    llm: join(home, "models", preset.llm),
    steps: Number(env.LOCAL_IMAGE_STEPS) || preset.steps,
    size: Number(env.LOCAL_IMAGE_SIZE) || 512,
    cfgScale: Number(env.LOCAL_IMAGE_CFG_SCALE) || preset.cfgScale,
    extraArgs: preset.extraArgs,
  };
}

export function missingLocalImageFiles(config: LocalImageConfig): string[] {
  return [config.sdCli, config.diffusionModel, config.vae, config.llm].filter((p) => !existsSync(p));
}

// Passed as an argv array (never through a shell), so a prompt can't inject
// anything whatever characters it contains.
export function buildSdCliArgs(config: LocalImageConfig, prompt: string, outFile: string): string[] {
  return [
    "--diffusion-model", config.diffusionModel,
    "--vae", config.vae,
    "--llm", config.llm,
    "--params-backend", "te=disk",
    "--max-vram", "7",
    ...config.extraArgs,
    "-p", prompt,
    "--steps", String(config.steps),
    "--cfg-scale", String(config.cfgScale),
    "-W", String(config.size),
    "-H", String(config.size),
    "--diffusion-fa",
    "-o", outFile,
  ];
}

export async function runLocalImage(prompt: string, timeoutMs: number): Promise<Buffer> {
  const config = resolveLocalImageConfig();
  const outFile = join(tmpdir(), `jennysol-image-${randomUUID()}.png`);
  const args = buildSdCliArgs(config, prompt, outFile);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        config.sdCli,
        args,
        { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            // Logged by the worker — keep user prompt text out of logs on disk.
            const tail = String(stderr).split(prompt).join("[prompt]").slice(-2000);
            // Not err.message: Node puts the full argv (prompt included) in it.
            const how = err.killed ? "timed out" : `exit ${err.code ?? "?"}${err.signal ? `, ${err.signal}` : ""}`;
            reject(new Error(`sd-cli failed (${how})\n${tail}`));
            return;
          }
          resolve();
        }
      );
    });
    return await readFile(outFile);
  } finally {
    await rm(outFile, { force: true });
  }
}
