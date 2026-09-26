// P6-04: zamanlanmış yayın worker'ının üretim giriş noktası (`npm run worker:publishing`). Web sürecinden ayrı,
// aynı dağıtılmış kod, PostgreSQL ve özel medya deposuyla çalışır; genel bir dinleyicisi yoktur. Ortam
// değişkenleri dağıtım secret deposundan gelir; bu dosya .env okumaz. Migration'lar worker'dan önce çalışmalıdır.
import { prisma } from "@/lib/db";
import { createPublishingWorker, loadWorkerConfig } from "@/features/publishing/worker";

const worker = createPublishingWorker(loadWorkerConfig());
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "publishing-worker", event: "signal", category: signal, workerId: worker.workerId }));
  // Yeni talep yapılmaz; aktif çağrılar sınırlı süre beklenir. Yarım kalan deneme yeniden başlatmada kanıta göre kurtarılır.
  const { drained } = await worker.stop();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(drained ? 0 : 1);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

worker.run().then(
  async () => {
    if (shuttingDown) return;
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  },
  async () => {
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  },
);
