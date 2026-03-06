import iconv from "iconv-lite";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadGeneratedJson<T>(filename: string): T {
  const distPath = join(__dirname, "generated", filename);
  const srcPath = join(__dirname, "..", "src", "generated", filename);
  const resolvedPath = existsSync(distPath) ? distPath : srcPath;
  return JSON.parse(readFileSync(resolvedPath, "utf8")) as T;
}

const rawEncodeMap = loadGeneratedJson<Record<string, number[]>>("uao-encode.json");
const rawDecodeMap = loadGeneratedJson<Record<string, string>>("uao-decode.json");

const encodeMap = new Map<string, Buffer>(
  Object.entries(rawEncodeMap).map(([char, bytes]) => [char, Buffer.from(bytes)])
);

const decodeMap = new Map<number, string>(
  Object.entries(rawDecodeMap).map(([key, value]) => [Number(key), value])
);

export interface DecodeResult {
  text: string;
  remaining: Buffer;
}

export function encodeBig5UAO(text: string): Buffer {
  const chunks: Buffer[] = [];

  for (const char of text) {
    const mapped = encodeMap.get(char);
    if (mapped) {
      chunks.push(mapped);
      continue;
    }

    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      chunks.push(Buffer.from([codePoint]));
      continue;
    }

    const fallback = iconv.encode(char, "cp950");
    chunks.push(fallback.length > 0 ? fallback : Buffer.from("?"));
  }

  return Buffer.concat(chunks);
}

export function decodeBig5UAO(buffer: Buffer): DecodeResult {
  const chars: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const byte = buffer[offset];

    if (byte > 0x80) {
      if (offset + 1 >= buffer.length) {
        return {
          text: chars.join(""),
          remaining: buffer.subarray(offset),
        };
      }

      const code = (byte << 8) | buffer[offset + 1];
      const mapped = decodeMap.get(code);
      if (mapped !== undefined) {
        chars.push(mapped);
        offset += 2;
        continue;
      }
    }

    const mapped = decodeMap.get(byte);
    if (mapped !== undefined) {
      chars.push(mapped);
    } else {
      chars.push(String.fromCharCode(byte));
    }
    offset += 1;
  }

  return {
    text: chars.join(""),
    remaining: Buffer.alloc(0),
  };
}
