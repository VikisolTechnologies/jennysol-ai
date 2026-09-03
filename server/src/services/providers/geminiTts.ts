import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// Gemini TTS returns raw 16-bit signed little-endian PCM at 24kHz mono, with
// no container — browsers can't play that directly, so we wrap it in a
// minimal 44-byte WAV header ourselves rather than pull in a dependency.
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export interface GeneratedSpeech {
  mimeType: string;
  data: string; // base64 WAV
}

export async function generateSpeech(text: string, voiceName: string): Promise<GeneratedSpeech> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: text,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((p) => p.inlineData?.data);
  if (!audioPart?.inlineData?.data) {
    throw new Error("The model didn't return audio for that text.");
  }

  const pcm = Buffer.from(audioPart.inlineData.data, "base64");
  const wav = pcmToWav(pcm);
  return { mimeType: "audio/wav", data: wav.toString("base64") };
}
