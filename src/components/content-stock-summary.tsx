import Link from "next/link";
import type { ContentStockReport } from "@/features/content-stock/service";

const statusLabels: Record<ContentStockReport["status"], string> = { HEALTHY: "Sağlıklı", LOW: "Düşük", CRITICAL: "Kritik" };
const requirementLabels: Record<string, string> = { PHOTO_PRODUCT: "Ürün fotoğrafı", PHOTO_ATMOSPHERE: "Mekân fotoğrafı", PHOTO_PEOPLE: "Ekip fotoğrafı", VIDEO_VERTICAL: "Dikey video", VIDEO_KITCHEN: "Hazırlık videosu", CUSTOM_GRAPHIC: "Özel tasarım" };

function headline(stock: ContentStockReport) {
  if (stock.upcomingCount === 0) return "Önümüzdeki dönemde medya gerektiren plan öğesi yok.";
  if (stock.status === "HEALTHY") return "Yaklaşan plan öğelerinin tamamı için medya hazır.";
  return `${stock.missingCount} plan öğesi için medya eksik.`;
}

export function ContentStockSummary({ stock }: { stock: ContentStockReport }) {
  return (
    <section className="stock-summary panel" aria-label="İçerik stoku">
      <div className="stock-copy">
        <span className="eyebrow dark">İçerik stoku</span>
        <h2>{headline(stock)}</h2>
        <p>{stock.coveredCount}/{stock.upcomingCount} yaklaşan öğe için medya hazır · {stock.policy.horizonDays} gün · operasyonel kapsama, performans puanı değildir.</p>
        {stock.missingByRequirement.length > 0 && (
          <ul className="stock-missing">
            {stock.missingByRequirement.map((line) => <li key={line.mediaRequirement}><strong>{line.missing}</strong> {requirementLabels[line.mediaRequirement] ?? line.mediaRequirement}</li>)}
          </ul>
        )}
      </div>
      <div className="stock-side">
        <span className={`status stock-${stock.status.toLowerCase()}`}>{statusLabels[stock.status]}</span>
        <Link href="/content-plan" className="stock-link">{stock.missingCount > 0 ? "Çekim görevlerine git →" : "İçerik planını aç →"}</Link>
      </div>
    </section>
  );
}
