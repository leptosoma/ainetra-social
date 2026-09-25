"use client";

import { useActionState, useId, useRef } from "react";
import { captureUploadAction, type CaptureUploadState } from "@/actions/media";

// P5.5B: yerel tarayıcı dosya girdisiyle çekim/yükleme. Kamera kütüphanesi yoktur:
// `capture="environment"` destekleyen telefonlarda arka kamerayı doğrudan açar; desteklemeyen
// tarayıcılar aynı girdiyi galeri/dosya seçicisi olarak gösterir (doğal geri dönüş). Dosya
// seçilince form kendiliğinden gönderilir; doğrulama, kiracı ve etiket kararı sunucudadır.

const initialState: CaptureUploadState = { status: "idle", message: "" };

export function CaptureFileButton({ label, hint, icon, accept, capture, captureRequestId, businessId, variant = "default" }: {
  label: string;
  hint?: string;
  icon?: string;
  accept: string;
  capture?: "environment" | "user";
  /** Varsa işletme ve etiket sunucuda bu görevden türetilir. */
  captureRequestId?: string;
  /** Görevsiz yükleme için; üyelik sunucuda denetlenir. */
  businessId?: string;
  variant?: "default" | "primary";
}) {
  const [state, formAction, pending] = useActionState(captureUploadAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const statusId = useId();

  return (
    <form ref={formRef} action={formAction} className={`capture-file ${variant}`} aria-busy={pending}>
      {captureRequestId ? <input type="hidden" name="captureRequestId" value={captureRequestId} /> : <input type="hidden" name="businessId" value={businessId ?? ""} />}
      <label htmlFor={inputId} className="capture-file-label">
        {icon && <span className="capture-file-icon" aria-hidden="true">{icon}</span>}
        <span className="capture-file-copy">
          <strong>{pending ? "Yükleniyor…" : label}</strong>
          {hint && <small>{hint}</small>}
        </span>
      </label>
      <input
        id={inputId}
        className="visually-hidden"
        name="file"
        type="file"
        accept={accept}
        capture={capture}
        disabled={pending}
        aria-describedby={statusId}
        onChange={(event) => { if (event.currentTarget.files?.length) formRef.current?.requestSubmit(); }}
      />
      <p id={statusId} className={`capture-file-status ${state.status}`} role="status" aria-live="polite">{state.message}</p>
    </form>
  );
}
