import { dismissCaptureRequestAction } from "@/actions/capture-engine";
import { uploadMediaAction } from "@/actions/media";
import type { listCaptureRequests } from "@/features/capture-engine/service";

type CaptureListItem = Awaited<ReturnType<typeof listCaptureRequests>>[number];

const acceptByMediaType: Record<"IMAGE" | "VIDEO", string> = {
  IMAGE: "image/jpeg,image/png,image/webp",
  VIDEO: "video/mp4,video/quicktime,video/webm",
};

export function CaptureList({ requests, variant = "full" }: { requests: CaptureListItem[]; variant?: "full" | "compact" }) {
  if (!requests.length) {
    return variant === "compact" ? null : <p className="muted">Bu hafta için bekleyen çekim görevi yok.</p>;
  }
  const visible = variant === "compact" ? requests.slice(0, 3) : requests;
  return (
    <section className="capture-list panel">
      <div className="capture-list-heading"><span className="eyebrow dark">Çekim görevleri</span><h2>Bu hafta senden ihtiyacımız olanlar</h2></div>
      <div className="capture-grid">
        {visible.map((request) => (
          <article className="capture-card" key={request.id}>
            <h3>{request.title}</h3>
            <p>{request.instructions}</p>
            <small>Son gün: {request.dueAt.toLocaleDateString("tr-TR", { day: "2-digit", month: "long" })}</small>
            <form action={uploadMediaAction} className="capture-upload-form" encType="multipart/form-data">
              <input type="hidden" name="businessId" value={request.businessId} />
              <input type="hidden" name="tags" value={request.mediaRequirement} />
              <input name="file" type="file" accept={acceptByMediaType[request.requestedMediaType]} required />
              <button className="mini-button" type="submit">Yükle</button>
            </form>
            <form action={dismissCaptureRequestAction}>
              <input type="hidden" name="captureRequestId" value={request.id} />
              <button className="icon-button" type="submit" aria-label="Görevi reddet">×</button>
            </form>
          </article>
        ))}
      </div>
      {variant === "compact" && requests.length > visible.length && <a href="/content-plan" className="capture-see-all">Tümünü gör ({requests.length})</a>}
    </section>
  );
}
