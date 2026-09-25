import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSession } from "@/features/auth/session";
import { META_POST_FLOW_PATH, META_SELECTION_PATH, loadMetaConfig } from "@/features/meta-connection/config";
import { handleMetaCallback } from "@/features/meta-connection/service";
import { META_SELECTION_COOKIE, selectionCookieOptions } from "@/features/meta-connection/selection-cookie";

// P6-02 Meta OAuth callback. Kod ve token yalnızca sunucuda işlenir; yanıt yalnızca sabit, izinli bir
// uygulama yoluna yönlendirir (istemciden gelen dönüş adresi kullanılmaz).

function appOrigin(request: NextRequest) {
  try {
    const config = loadMetaConfig();
    if (config) return new URL(config.redirectUri).origin;
  } catch {
    // Yapılandırma hatası isteğin kendi kökenine düşer; hata kodu yine kapalı kümeden gelir.
  }
  return request.nextUrl.origin;
}

function redirectTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, appOrigin(request)), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const session = await getCurrentSession();
  let result;
  try {
    result = await handleMetaCallback(session ? { userId: session.userId, sessionId: session.id } : null, {
      state: params.get("state"),
      code: params.get("code"),
      error: params.get("error"),
    });
  } catch {
    // Beklenmeyen hata ayrıntısı (URL, kod, token içerebilir) loglanmaz ve istemciye verilmez.
    return redirectTo(request, `${META_POST_FLOW_PATH}?metaError=ACTION_FAILED`);
  }
  if (result.kind === "ERROR") return redirectTo(request, `${META_POST_FLOW_PATH}?metaError=${result.code}`);
  const response = redirectTo(request, META_SELECTION_PATH);
  response.cookies.set(META_SELECTION_COOKIE, result.selectionHandle, selectionCookieOptions());
  return response;
}
