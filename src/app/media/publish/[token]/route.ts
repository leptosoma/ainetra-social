import { resolveSignedMedia } from "@/features/publishing/media-delivery";

// P6-03: Meta'nın Instagram konteyneri için görseli çektiği kısa ömürlü, çerezsiz, salt okunur uç nokta.
// Jeton bir sırdır: yanıt veya hata metnine yazılmaz, yönlendirme yapılmaz, önbelleğe alınmaz.

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let media;
  try {
    media = await resolveSignedMedia(token);
  } catch {
    media = null;
  }
  if (!media) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  return new Response(Buffer.from(media.bytes), {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.bytes.byteLength),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
