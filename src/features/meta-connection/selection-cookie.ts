import "server-only";

import { META_SELECTION_TTL_MS } from "./config";

// Tek kullanımlık seçim tutamacı yalnızca httpOnly çerezde taşınır; URL'ye, istemci prop'una veya
// tarayıcı depolamasına yazılmaz.
export const META_SELECTION_COOKIE = "ainetra_meta_selection";

export function selectionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/settings",
    maxAge: Math.floor(META_SELECTION_TTL_MS / 1000),
  };
}
