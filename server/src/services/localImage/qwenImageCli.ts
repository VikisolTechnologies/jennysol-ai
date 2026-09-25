import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Qwen-Image-2.1 is licensed under the Qwen Research License (non-commercial
// only) — see JENNY_MODEL_LICENSE_MATRIX.md before relying on this for
// anything revenue-generating.
export interface QwenImagePaths {
  sdCli: string;
  diffusionModel: string;
  vae: string;
  llm: string;
}

export function resolveQwenImagePaths(env: NodeJS.ProcessEnv = process.env): QwenImagePaths {
  const home = env.QWEN_IMAGE_HOME || join(homedir(), ".jennysol", "image");
  return {
    sdCli: join(home, "bin", "sd-cli"),
    diffusionModel: join(home, "models", "qwen-image-2.1-Q4_K_M.gguf"),
    vae: join(home, "models", "qwen_image_2.1_vae_bf16.safetensors"),
    llm: join(home, "models", "Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf"),
  };
}

export function missingQwenImageFiles(paths: QwenImagePaths): string[] {
  return Object.values(paths).filter((p) => !existsSync(p));
}

export interface QwenImageSettings {
  steps: number;
  size: number;
  cfgScale: number;
}

// Defaults are what's practical on the M1 Pro 16GB, measured 2026-09-25:
// 512px/12 steps took 5m16s (~21s/step + ~45s load/encode/decode);
// Unsloth's 1024px/20 steps took 32.6 min. Raise these on a real GPU.
export function resolveQwenImageSettings(env: NodeJS.ProcessEnv = process.env): QwenImageSettings {
  return {
    steps: Number(env.QWEN_IMAGE_STEPS) || 12,
    size: Number(env.QWEN_IMAGE_SIZE) || 512,
    cfgScale: Number(env.QWEN_IMAGE_CFG_SCALE) || 6.0,
  };
}

// Unsloth's documented invocation plus two memory flags. Measured on this
// M1 Pro 16GB (2026-09-25): without them the text encoder stays resident
// (9.07GB of weights total) and Metal ran out of memory at step 9/20; with
// the encoder's weights left on disk and a 7GB GPU cap, peak footprint was
// 5.4GB and it completed. Passed as an argv array (never through a shell),
// so a prompt can't inject anything whatever characters it contains.
export function buildSdCliArgs(paths: QwenImagePaths, settings: QwenImageSettings, prompt: string, outFile: string): string[] {
  return [
    "--diffusion-model", paths.diffusionModel,
    "--vae", paths.vae,
    "--llm", paths.llm,
    "--params-backend", "te=disk",
    "--max-vram", "7",
    "-p", prompt,
    "--steps", String(settings.steps),
    "--cfg-scale", String(settings.cfgScale),
    "--sampling-method", "euler",
    "-W", String(settings.size),
    "-H", String(settings.size),
    "--diffusion-fa",
    "-o", outFile,
  ];
}

export async function runQwenImage(prompt: string, timeoutMs: number): Promise<Buffer> {
  const paths = resolveQwenImagePaths();
  const outFile = join(tmpdir(), `jennysol-qwen-image-${randomUUID()}.png`);
  const args = buildSdCliArgs(paths, resolveQwenImageSettings(), prompt, outFile);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        paths.sdCli,
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
