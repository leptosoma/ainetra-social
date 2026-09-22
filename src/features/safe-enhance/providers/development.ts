import sharp from "sharp";
import type { ProviderOutput } from "../schemas";
import type { ImageTransformProvider, ImageTransformProviderInput } from "./types";

// GELİŞTİRME SAĞLAYICISI — gerçek/üretken yapay zekâ DEĞİLDİR.
// Yapılandırılmış bir görsel dönüştürme servisi (kimlik bilgisi) olmadığında kullanılır. Yalnızca
// `sharp` ile deterministik, piksel düzeyi ayarlar uygular: parlaklık, kontrast, doygunluk, sıcaklık,
// hafif keskinleştirme ve medyan gürültü azaltma. Görüntüdeki hiçbir nesneyi tanımaz, eklemez, çıkarmaz;
// kırpmaz, döndürmez ve yeniden boyutlandırmaz; EXIF yön bilgisi korunur ki çıktı kaynakla aynı
// şekilde görüntülensin. Çıktı biçimi kaynağın biçimiyle aynıdır (JPEG→JPEG, PNG→PNG, WebP→WebP).

const outputFormats: Record<string, "jpeg" | "png" | "webp"> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export class DevelopmentSharpTransformProvider implements ImageTransformProvider {
  readonly provider = "development-sharp-local";
  readonly model = "none";
  readonly provenance = "DEVELOPMENT" as const;

  async transform(input: ImageTransformProviderInput): Promise<unknown> {
    const format = outputFormats[input.mimeType];
    if (!format) throw new Error(`Unsupported mime type: ${input.mimeType}`);
    const { brightness, contrast, saturation, warmth, sharpen, denoise } = input.operations;
    let pipeline = sharp(input.bytes).withMetadata();
    if (denoise) pipeline = pipeline.median(3);
    pipeline = pipeline.modulate({ brightness, saturation });
    // Kontrast: out = a·in + b, b = 128·(1−a) → orta gri sabit kalır. Sıcaklık kanal çarpanı aynı adımda uygulanır.
    const offset = 128 * (1 - contrast);
    pipeline = pipeline.linear([contrast * (1 + warmth), contrast, contrast * (1 - warmth)], [offset, offset, offset]);
    if (sharpen > 0) pipeline = pipeline.sharpen({ sigma: sharpen });
    if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 90, mozjpeg: false });
    else if (format === "png") pipeline = pipeline.png();
    else pipeline = pipeline.webp({ quality: 90 });
    const buffer = await pipeline.toBuffer();
    const output: ProviderOutput = { bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
    return output;
  }
}
