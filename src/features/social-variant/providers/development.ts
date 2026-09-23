import sharp from "sharp";
import type { z } from "zod";
import { providerOutputSchema } from "../schemas";
import type { ImageReframeProvider, ImageReframeProviderInput } from "./types";

// GELİŞTİRME SAĞLAYICISI — gerçek/üretken yapay zekâ DEĞİLDİR ve konu tanıyan bir kırpma DEĞİLDİR.
// Yalnızca `sharp` ile verilen sabit geometriyi uygular: merkez kırpma kutusunu keser, hedef tuvale
// ölçekler ve CONTAIN durumunda boşlukları verilen düz renkle doldurur. Görüntüdeki hiçbir nesneyi
// tanımaz, eklemez, çıkarmaz; ışık, renk veya kontrast ayarı yapmaz. Çıktı biçimi kaynağınkiyle
// aynıdır (JPEG→JPEG, PNG→PNG, WebP→WebP) ve EXIF yön bilgisi korunur.

const outputFormats: Record<string, "jpeg" | "png" | "webp"> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export class DevelopmentSharpReframeProvider implements ImageReframeProvider {
  readonly provider = "development-sharp-local";
  readonly model = "none";
  readonly provenance = "DEVELOPMENT" as const;

  async reframe(input: ImageReframeProviderInput): Promise<unknown> {
    const format = outputFormats[input.mimeType];
    if (!format) throw new Error(`Unsupported mime type: ${input.mimeType}`);
    const { crop, output, fit, padColor } = input.operations;
    let pipeline = sharp(input.bytes).withMetadata().extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height });
    pipeline = fit === "CONTAIN"
      ? pipeline.resize({ width: output.width, height: output.height, fit: "contain", background: { ...padColor, alpha: 1 } })
      : pipeline.resize({ width: output.width, height: output.height, fit: "fill" });
    if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 90, mozjpeg: false });
    else if (format === "png") pipeline = pipeline.png();
    else pipeline = pipeline.webp({ quality: 90 });
    const buffer = await pipeline.toBuffer();
    const result: z.infer<typeof providerOutputSchema> = { bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
    return result;
  }
}
