import { acceptContentFallbackAction, proposeContentFallbackAction } from "@/actions/content-fallback";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type { FallbackSource, listContentFallbackProposals } from "@/features/content-fallback/service";

type Proposal = NonNullable<ReturnType<Awaited<ReturnType<typeof listContentFallbackProposals>>["get"]>>;

const kindLabels: Record<Proposal["kind"], string> = {
  UNUSED_AUTHENTIC_MEDIA: "Kullanılmamış medya",
  OLDER_UNUSED_AUTHENTIC_MEDIA: "Eski kullanılmamış medya",
  REUSABLE_AUTHENTIC_MEDIA: "Yeniden kullanılabilir medya",
  FORMAT_ADAPTATION: "Format uyarlaması",
  CONFIRMED_BUSINESS_INFO: "Onaylı işletme bilgisi",
  VERIFIED_SOCIAL_PROOF: "Doğrulanmış sosyal kanıt",
  BRAND_CREATIVE_PLACEHOLDER: "Marka yer tutucu tasarımı",
};

function sourceLine(source: FallbackSource) {
  if (source.type === "MEDIA_ASSET") return `${source.originalFilename} · ${source.usageCount ? `${source.usageCount} kez kullanıldı` : "hiç kullanılmadı"}`;
  if (source.type === "BUSINESS_ATTRIBUTE") return `${source.value} · onaylı (${source.source})`;
  if (source.type === "VERIFIED_SOCIAL_PROOF") return `${source.label} · ${source.sourceReference}`;
  return `${source.businessName} marka kimliği`;
}

/** Medyası eksik bir plan öğesi için kural tabanlı yedek önerisi: yoksa öneri iste, varsa incele ve açıkça kabul et. */
export function FallbackProposal({ planId, itemId, proposal }: { planId: string; itemId: string; proposal?: Proposal }) {
  if (!proposal) {
    return (
      <form action={proposeContentFallbackAction} className="fallback-request">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="itemId" value={itemId} />
        <PendingSubmitButton idle="Yedek öneri iste" pending="Değerlendiriliyor…" className="mini-button" />
      </form>
    );
  }
  const sources = Array.isArray(proposal.sources) ? (proposal.sources as FallbackSource[]) : [];
  return (
    <div className="fallback-proposal" aria-label="Yedek önerisi">
      <span className="fallback-kind">{kindLabels[proposal.kind]}</span>
      <p>{proposal.rationale}</p>
      {sources.length > 0 && <ul>{sources.map((source, index) => <li key={`${source.type}-${index}`}>{sourceLine(source)}</li>)}</ul>}
      <small>Kural tabanlı öneri; kabul edilene kadar plan değişmez.</small>
      <form action={acceptContentFallbackAction}>
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="proposalId" value={proposal.id} />
        <PendingSubmitButton idle="Öneriyi kabul et" pending="Uygulanıyor…" className="mini-button accept" />
      </form>
    </div>
  );
}
