import sharp from "sharp";
import type { z } from "zod";
import { toCssColor } from "@/features/brand-style/palette";
import type { providerOutputSchema } from "../schemas";
import type { CreativeRenderProvider, CreativeRenderProviderInput } from "./types";

// YEREL ŞABLON SAĞLAYICISI — üretken yapay zekâ DEĞİLDİR.
// Verilen metni, marka tercihlerinden türetilen renk kümesiyle sabit bir yerleşime yerleştirir:
// başlık, ince bir vurgu çizgisi, en fazla üç bilgi satırı ve "Tasarım görseli" işareti. Hiçbir
// nesne, kişi, ürün, mekân veya sahne üretmez; metni yorumlamaz, genişletmez veya süslemez.
// Aynı girdi her zaman aynı çıktıyı verir.
//
// Kabul edilmiş gerçek bir medya arka plan olarak verildiğinde yalnızca kırpılıp karartılır; üzerine
// tasarım katmanı gelir. Sonuç yine bir tasarımdır ve ürün/ekip/mekân fotoğrafı olarak sunulmaz.

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => escapes[character]);
}

/** Kaba ama deterministik sarma: ortalama karakter genişliğine göre satırlara böler. */
function wrap(value: string, maxChars: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length <= maxChars ? word : word.slice(0, maxChars);
  }
  if (current) lines.push(current);
  return lines.length ? lines : [value.slice(0, maxChars)];
}

function buildSvg(input: CreativeRenderProviderInput) {
  const { canvas, palette, copy } = input;
  const padding = Math.round(canvas.width * 0.09);
  const headlineSize = Math.max(18, Math.round(canvas.width / 13));
  const bodySize = Math.max(14, Math.round(canvas.width / 24));
  const noteSize = Math.max(10, Math.round(canvas.width / 38));
  const innerWidth = canvas.width - padding * 2;
  const background = toCssColor(palette.background);
  const foreground = toCssColor(palette.foreground);
  const accent = toCssColor(palette.accent);

  const headlineLines = wrap(copy.headline, Math.max(8, Math.floor(innerWidth / (headlineSize * 0.56))));
  const bodyLines = copy.lines.flatMap((line) => wrap(line, Math.max(12, Math.floor(innerWidth / (bodySize * 0.54)))));

  let cursor = padding + headlineSize;
  const headlineSpans = headlineLines.map((line) => {
    const element = `<text x="${padding}" y="${cursor}" font-family="sans-serif" font-size="${headlineSize}" font-weight="800" fill="${foreground}">${escapeXml(line)}</text>`;
    cursor += Math.round(headlineSize * 1.15);
    return element;
  }).join("");

  const barY = cursor + Math.round(headlineSize * 0.2);
  const barHeight = Math.max(3, Math.round(canvas.height * 0.007));
  cursor = barY + barHeight + Math.round(bodySize * 1.6);

  const bodySpans = bodyLines.map((line) => {
    const element = `<text x="${padding}" y="${cursor}" font-family="sans-serif" font-size="${bodySize}" font-weight="500" fill="${foreground}">${escapeXml(line)}</text>`;
    cursor += Math.round(bodySize * 1.5);
    return element;
  }).join("");

  const noteY = canvas.height - padding;
  const backdrop = input.background
    ? ""
    : `<rect width="${canvas.width}" height="${canvas.height}" fill="${background}"/>`;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">` +
    backdrop +
    headlineSpans +
    `<rect x="${padding}" y="${barY}" width="${Math.round(innerWidth * 0.22)}" height="${barHeight}" fill="${accent}"/>` +
    bodySpans +
    `<text x="${padding}" y="${noteY}" font-family="sans-serif" font-size="${noteSize}" font-weight="700" letter-spacing="${Math.max(1, Math.round(noteSize * 0.12))}" fill="${accent}">${escapeXml(copy.designNote.toLocaleUpperCase("tr"))}</text>` +
    `</svg>`,
  );
}

/**
 * SVG'yi tam olarak tuval boyutunda piksele çevirir. SVG'nin bildirdiği genişlik/yükseklik piksel
 * cinsindendir, ama rasterleştirme çözünürlüğü sharp'ın varsayılanına bırakılırsa çıktı ölçeklenir;
 * bu yüzden yoğunluk 72 DPI'ya (1 SVG birimi = 1 piksel) sabitlenir ve sonuç ayrıca tuvale
 * uydurulur. Böylece çıktı boyutu her ortamda öngörülebilir kalır.
 */
function rasterize(svg: Buffer, canvas: { width: number; height: number }) {
  return sharp(svg, { density: 72 }).resize({ width: canvas.width, height: canvas.height, fit: "fill" }).png().toBuffer();
}

export class LocalTemplateCreativeProvider implements CreativeRenderProvider {
  readonly provider = "development-template-local";
  readonly model = "none";
  readonly provenance = "DEVELOPMENT" as const;
  readonly generative = false;

  async render(input: CreativeRenderProviderInput): Promise<unknown> {
    const { canvas, palette } = input;
    const overlay = await rasterize(buildSvg(input), canvas);

    if (!input.background) {
      const result: z.infer<typeof providerOutputSchema> = { bytes: new Uint8Array(overlay.buffer, overlay.byteOffset, overlay.byteLength), mimeType: "image/png" };
      return result;
    }

    // Arka plan yalnızca kırpılır ve marka rengiyle karartılır; içerik değiştirilmez.
    const base = await sharp(input.background.bytes)
      .resize({ width: canvas.width, height: canvas.height, fit: "cover", position: "centre" })
      .toBuffer();
    const scrim = await rasterize(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">` +
        `<rect width="${canvas.width}" height="${canvas.height}" fill="${toCssColor(palette.background)}" fill-opacity="0.72"/></svg>`,
      ),
      canvas,
    );
    const buffer = await sharp(base)
      .composite([{ input: scrim, top: 0, left: 0 }, { input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 90, mozjpeg: false })
      .toBuffer();
    const result: z.infer<typeof providerOutputSchema> = { bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), mimeType: "image/jpeg" };
    return result;
  }
}
