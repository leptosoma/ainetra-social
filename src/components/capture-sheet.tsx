"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { captureAcceptByMediaType, galleryAccept, type CapturePrompt } from "@/features/capture-engine/prompt";
import { CaptureFileButton } from "./capture-file-button";
import { useModalFocus } from "./use-modal-focus";

// P5.5B: ortadaki çekim düğmesinin açtığı alt sayfa. Güncel bir çekim görevi varsa önce o görev
// kendi yönergesiyle gösterilir; genel çekim/galeri seçenekleri her zaman kalır.
// `Ainetra ile içerik hazırla` mevcut İçerik Planı akışına gider (yedek öneri, çekim görevleri ve
// medya eşleştirme orada); yeni bir motor ya da otomatik plan değişikliği yoktur.

export function CaptureSheet({ open, onClose, businessId, prompts }: {
  open: boolean;
  onClose: () => void;
  businessId?: string;
  prompts: CapturePrompt[];
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(sheetRef, open, onClose);
  if (!open) return null;
  const [current, ...others] = prompts;

  return (
    <div className="capture-sheet-layer">
      <div className="capture-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="capture-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <span className="capture-sheet-grip" aria-hidden="true" />
          <h2 id={titleId}>Çek ve yükle</h2>
          <button type="button" className="icon-button static" onClick={onClose} aria-label="Kapat">×</button>
        </header>

        {!businessId ? (
          <p className="capture-sheet-empty">Medya yüklemek için önce işletmenizi oluşturun. <Link href="/dashboard" onClick={onClose}>İşletme oluştur →</Link></p>
        ) : (
          <>
            {current && (
              <section className="capture-context" aria-label="Şu an gereken çekim">
                <span className="eyebrow dark">Şu an gerekiyor</span>
                <CaptureFileButton
                  variant="primary"
                  icon={current.mediaType === "VIDEO" ? "◉" : "◎"}
                  label={current.headline}
                  hint={current.detail}
                  accept={current.accept}
                  capture="environment"
                  captureRequestId={current.captureRequestId}
                />
                <details className="capture-guidance">
                  <summary>Nasıl çekeyim?</summary>
                  <strong>{current.title}</strong>
                  <p>{current.instructions}</p>
                </details>
                {others.length > 0 && (
                  <ul className="capture-others">
                    {others.map((prompt) => (
                      <li key={prompt.captureRequestId}>
                        <CaptureFileButton
                          label={prompt.headline}
                          hint={prompt.detail}
                          accept={prompt.accept}
                          capture="environment"
                          captureRequestId={prompt.captureRequestId}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <div className="capture-actions">
              <CaptureFileButton icon="◎" label="Fotoğraf çek" hint="Kamera açılır" accept={captureAcceptByMediaType.IMAGE} capture="environment" businessId={businessId} />
              <CaptureFileButton icon="◉" label="Video çek" hint="Kamera açılır" accept={captureAcceptByMediaType.VIDEO} capture="environment" businessId={businessId} />
              <CaptureFileButton icon="▧" label="Galeriden yükle" hint="Fotoğraf veya video" accept={galleryAccept} businessId={businessId} />
              <Link href="/content-plan" className="capture-action-link" onClick={onClose}>
                <span className="capture-file-icon" aria-hidden="true">✦</span>
                <span className="capture-file-copy"><strong>Ainetra ile içerik hazırla</strong><small>İçerik planı ve yedek öneriler</small></span>
              </Link>
            </div>
            <small className="capture-sheet-note">Görev dışı çekimler etiketsiz olarak Medya kütüphanesine eklenir; orijinal dosya değiştirilmez.</small>
          </>
        )}
      </div>
    </div>
  );
}
