import { MetaGraphError } from "@/features/meta-connection/graph-client";
import type { PublishOutcome, RedactedDiagnostics } from "./adapter";

// P6-03: Meta hatalarını kapalı ve redakte edilmiş bir sınıflandırmaya çevirir. Ham sağlayıcı mesajı, URL,
// token, altyazı veya medya baytı asla taşınmaz; yalnızca tür/kod/alt kod, HTTP durumu ve izleme kimliği.
//
// Aşama önemlidir:
// - PRE_PUBLISH: henüz yayın çağrısı yapılmadı (doğrulama, kota, IG konteyner oluşturma/durum). Konteyner
//   gönderi değildir; bu aşamadaki zaman aşımı/ağ hatası yayına yol açamaz, bu yüzden güvenle yeniden denenebilir.
// - PUBLISH: yayın çağrısı (IG media_publish, FB /feed, FB /photos) gönderildi. Zaman aşımı, kopan bağlantı,
//   belirsiz 5xx veya kimliksiz yanıt UNKNOWN'dur; asla otomatik yeniden gönderilmez.

export type MetaCallPhase = "PRE_PUBLISH" | "PUBLISH";

export type MetaRejectionCode =
  | "AUTH_INVALID"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "CONTAINER_NOT_READY"
  | "PROVIDER_TRANSIENT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const IG_PUBLISH_LIMIT_SUBCODE = 2207042;
const IG_MEDIA_NOT_READY_CODE = 9007;

export function metaDiagnostics(error: MetaGraphError): RedactedDiagnostics {
  const parts = [`META_${error.kind}`];
  if (error.details.code !== undefined) parts.push(String(error.details.code));
  if (error.details.subcode !== undefined) parts.push(String(error.details.subcode));
  const diagnostics: RedactedDiagnostics = { code: parts.join("_") };
  if (error.details.httpStatus !== undefined) diagnostics.httpStatus = error.details.httpStatus;
  if (error.details.traceId) diagnostics.providerRequestId = error.details.traceId;
  return diagnostics;
}

function rejected(retryable: boolean, errorCode: MetaRejectionCode, diagnostics: RedactedDiagnostics): PublishOutcome {
  return { kind: "REJECTED", retryable, errorCode, diagnostics };
}

export function classifyMetaFailure(error: unknown, phase: MetaCallPhase, providerReference?: string): PublishOutcome {
  if (!(error instanceof MetaGraphError)) {
    const diagnostics: RedactedDiagnostics = { code: "INTERNAL_ERROR" };
    return phase === "PUBLISH"
      ? { kind: "UNKNOWN", reason: "PROVIDER_AMBIGUOUS", providerReference, diagnostics }
      : rejected(true, "PROVIDER_UNAVAILABLE", diagnostics);
  }
  const diagnostics = metaDiagnostics(error);
  const unknown = (reason: "TIMEOUT" | "TRANSPORT_ERROR" | "PROVIDER_AMBIGUOUS"): PublishOutcome =>
    phase === "PUBLISH" ? { kind: "UNKNOWN", reason, providerReference, diagnostics } : rejected(true, "PROVIDER_UNAVAILABLE", diagnostics);

  if (error.kind === "TIMEOUT") return unknown("TIMEOUT");
  if (error.kind === "TRANSPORT") return unknown("TRANSPORT_ERROR");
  if (error.kind === "INVALID_RESPONSE") return unknown("PROVIDER_AMBIGUOUS");

  const { code, subcode, httpStatus, isTransient } = error.details;
  // Kesin ret: Meta isteği işlemediğini açıkça bildirdi.
  if (code === 190) return rejected(false, "AUTH_INVALID", diagnostics);
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return rejected(false, "PERMISSION_DENIED", diagnostics);
  if ((code !== undefined && RATE_LIMIT_CODES.has(code)) || subcode === IG_PUBLISH_LIMIT_SUBCODE) return rejected(true, "RATE_LIMITED", diagnostics);
  if (code === IG_MEDIA_NOT_READY_CODE) return rejected(true, "CONTAINER_NOT_READY", diagnostics);
  // Sunucu hatası, bilinmeyen/geçici genel hata kodları (1, 2) ya da durum kodu yok: kabul edilip edilmediği belirsiz.
  if (httpStatus === undefined || httpStatus >= 500 || code === 1 || code === 2 || code === undefined) return unknown("PROVIDER_AMBIGUOUS");
  if (isTransient === true) return rejected(true, "PROVIDER_TRANSIENT", diagnostics);
  return rejected(false, "PROVIDER_REJECTED", diagnostics);
}
