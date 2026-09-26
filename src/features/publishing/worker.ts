import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain-error";
import { loadMetaConfig } from "@/features/meta-connection/config";
import { loadCredentialKeyring } from "@/features/meta-connection/crypto";
import { ensureScheduledPublishIntent } from "./intent";
import { loadMediaDeliveryConfig } from "./media-delivery";
import { dispatchPublishIntentForWorker, publishNowErrorCode, recoverExpiredLease, type PublishNowDeps } from "./submission";

// P6-04: Ainetra'ya ait, ayrı süreçte çalışan PostgreSQL yoklayıcısı. İkinci bir kuyruk, Redis veya BullMQ
// yoktur; PostgreSQL tek doğruluk kaynağıdır. Yoklama sorguları yalnızca tavsiye niteliğindedir: tek talep
// otoritesi P6-03'ün kısa Serializable CAS talebidir (claimIntent). Worker oturum açmış kullanıcı gerektirmez;
// kiracı/hesap/snapshot/kimlik bilgisi/izin denetimleri kullanıcı yoluyla aynı çekirdekte çalışır.
//
// Her tur: (1) süresi dolmuş IN_FLIGHT kiralamalarını kanıta göre kurtar, (2) zamanı gelmiş ve intent'i olmayan
// planlı gönderiler için intent oluştur, (3) zamanı gelmiş PENDING ve güvenli, zamanı gelmiş RETRY_WAIT
// intent'lerini sınırlı eşzamanlılıkla gönder. Her iş yalıtılmıştır; biri bozuksa diğerleri sürer.

export type WorkerConfig = {
  batchSize: number;
  intervalMs: number;
  concurrency: number;
  shutdownTimeoutMs: number;
};

export const DEFAULT_WORKER_CONFIG: WorkerConfig = { batchSize: 25, intervalMs: 15_000, concurrency: 4, shutdownTimeoutMs: 30_000 };

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Ortam değişkenlerinden sınırlandırılmış yapılandırma; geçersiz değer varsayılana düşer. */
export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return {
    batchSize: boundedInt(env.PUBLISHING_WORKER_BATCH_SIZE, DEFAULT_WORKER_CONFIG.batchSize, 1, 100),
    intervalMs: boundedInt(env.PUBLISHING_WORKER_INTERVAL_MS, DEFAULT_WORKER_CONFIG.intervalMs, 1_000, 300_000),
    concurrency: boundedInt(env.PUBLISHING_WORKER_CONCURRENCY, DEFAULT_WORKER_CONFIG.concurrency, 1, 16),
    shutdownTimeoutMs: boundedInt(env.PUBLISHING_WORKER_SHUTDOWN_TIMEOUT_MS, DEFAULT_WORKER_CONFIG.shutdownTimeoutMs, 1_000, 600_000),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Yapılandırılmış, redakte log. Yalnızca izinli anahtarlar ve kapalı/kimlik biçimli değerler yazılır; token,
// şifreli değer, imzalı medya URL'si, altyazı, ham sağlayıcı gövdesi veya medya baytı asla log'a girmez.

const LOG_KEYS = [
  "event",
  "workerId",
  "intentId",
  "attemptId",
  "scheduledPostId",
  "state",
  "category",
  "durationMs",
  "dispatched",
  "due",
  "intentsCreated",
  "invalid",
  "recovered",
  "safeRetry",
  "reconciliationRequired",
  "published",
  "retryWait",
  "failed",
  "skipped",
  "errors",
  "drained",
  "metaConfigured",
  "mediaDeliveryConfigured",
  "retryInMs",
] as const;

export type WorkerLogKey = (typeof LOG_KEYS)[number];
export type WorkerLogEntry = Partial<Record<WorkerLogKey, string | number | boolean>> & { event: string };
export type WorkerLogger = (level: "info" | "warn" | "error", entry: Record<string, string | number | boolean>) => void;

const SAFE_LOG_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/;

export function sanitizeLogEntry(entry: WorkerLogEntry): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const key of LOG_KEYS) {
    const value = entry[key];
    if (value === undefined) continue;
    if (typeof value === "number") clean[key] = Number.isFinite(value) ? Math.round(value) : 0;
    else if (typeof value === "boolean") clean[key] = value;
    else clean[key] = SAFE_LOG_VALUE.test(value) ? value : "[redacted]";
  }
  return clean;
}

const consoleLogger: WorkerLogger = (level, entry) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, component: "publishing-worker", ...entry });
  if (level === "error") console.error(line);
  else console.log(line);
};

/** Hata kaydı için kapalı kategori; ham mesaj asla dönmez. */
function errorCategory(error: unknown): string {
  if (error instanceof DomainError) return publishNowErrorCode(error);
  const code = error && typeof error === "object" ? String((error as { code?: unknown }).code ?? "") : "";
  if (/^P\d{4}$/.test(code)) return `DB_${code}`;
  return "INTERNAL_ERROR";
}

// ---------------------------------------------------------------------------------------------------------

export type TickSummary = {
  due: number;
  intentsCreated: number;
  invalid: number;
  recovered: number;
  safeRetry: number;
  reconciliationRequired: number;
  dispatched: number;
  published: number;
  retryWait: number;
  failed: number;
  skipped: number;
  errors: number;
};

function emptySummary(): TickSummary {
  return { due: 0, intentsCreated: 0, invalid: 0, recovered: 0, safeRetry: 0, reconciliationRequired: 0, dispatched: 0, published: 0, retryWait: 0, failed: 0, skipped: 0, errors: 0 };
}

export type PublishingWorkerOptions = Partial<WorkerConfig> & {
  workerId?: string;
  /**
   * Belirleyici saat (testler). Verilmezse her tur başında veritabanı saati okunur ve tur boyunca monoton
   * olarak ilerletilir; makinenin yerel saat dilimi/saati karar vermez.
   */
  now?: () => Date;
  publish?: Partial<Omit<PublishNowDeps, "now">>;
  logger?: WorkerLogger;
  /** Ön koşulu tutmayan (ör. bağlantı yok) intent'lerin bu süreçte yeniden denenmeden önce bekleme süresi. */
  deferMs?: number;
  maxBackoffMs?: number;
};

export type PublishingWorker = {
  readonly workerId: string;
  tick(): Promise<TickSummary>;
  run(): Promise<void>;
  stop(): Promise<{ drained: boolean }>;
  readonly stopping: boolean;
  readonly activeJobs: number;
};

type Cursor = { at: Date; id: string } | null;

/** (zaman, id) anahtar kümesi sayfalaması: geçersiz satırlar tarama başını tıkayamaz. */
function after(field: "scheduledAt" | "dueAt" | "nextAttemptAt", cursor: Cursor) {
  if (!cursor) return {};
  return { OR: [{ [field]: { gt: cursor.at } }, { [field]: cursor.at, id: { gt: cursor.id } }] };
}

function advance<T extends { id: string }>(rows: T[], take: number, at: (row: T) => Date | null): Cursor {
  if (rows.length < take) return null;
  const last = rows[rows.length - 1];
  const time = at(last);
  return time ? { at: time, id: last.id } : null;
}

async function databaseNow(): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return new Date(rows[0].now);
}

export function createPublishingWorker(options: PublishingWorkerOptions = {}): PublishingWorker {
  const config: WorkerConfig = {
    batchSize: options.batchSize ?? DEFAULT_WORKER_CONFIG.batchSize,
    intervalMs: options.intervalMs ?? DEFAULT_WORKER_CONFIG.intervalMs,
    concurrency: Math.max(1, options.concurrency ?? DEFAULT_WORKER_CONFIG.concurrency),
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_WORKER_CONFIG.shutdownTimeoutMs,
  };
  const workerId = options.workerId ?? `pw-${process.pid}-${randomBytes(3).toString("hex")}`;
  const sink = options.logger ?? consoleLogger;
  const deferMs = options.deferMs ?? 5 * 60_000;
  const maxBackoffMs = options.maxBackoffMs ?? 60_000;
  const log = (level: "info" | "warn" | "error", entry: WorkerLogEntry) => {
    try {
      sink(level, sanitizeLogEntry({ ...entry, workerId }));
    } catch {
      // Log hatası işi durdurmaz.
    }
  };

  const deferred = new Map<string, number>();
  let postCursor: Cursor = null;
  let pendingCursor: Cursor = null;
  let retryCursor: Cursor = null;
  let stopping = false;
  let active = 0;
  let running: Promise<void> | null = null;
  let wake: (() => void) | null = null;

  async function tickClock(): Promise<() => Date> {
    if (options.now) return options.now;
    const anchor = await databaseNow();
    const started = performance.now();
    return () => new Date(anchor.getTime() + Math.round(performance.now() - started));
  }

  function deferredIds(nowMs: number) {
    for (const [id, until] of deferred) if (until <= nowMs) deferred.delete(id);
    return [...deferred.keys()].slice(0, 500);
  }

  async function recoverExpired(now: () => Date, summary: TickSummary) {
    const expired = await prisma.publishIntent.findMany({
      where: { state: "IN_FLIGHT", leaseExpiresAt: { lte: now() } },
      select: { id: true },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
      take: config.batchSize,
    });
    for (const { id } of expired) {
      if (stopping) return;
      const started = Date.now();
      try {
        const intent = await recoverExpiredLease(id, now());
        summary.recovered++;
        if (intent.state === "RETRY_WAIT") summary.safeRetry++;
        else if (intent.state === "UNKNOWN") summary.reconciliationRequired++;
        else if (intent.state === "FAILED") summary.failed++;
        log(intent.state === "UNKNOWN" ? "warn" : "info", { event: "lease_recovered", intentId: id, state: intent.state, category: intent.state === "UNKNOWN" ? "RECONCILIATION_REQUIRED" : "PRE_PUBLISH_SAFE", durationMs: Date.now() - started });
      } catch (error) {
        summary.errors++;
        log("error", { event: "lease_recovery_failed", intentId: id, category: errorCategory(error), durationMs: Date.now() - started });
      }
    }
  }

  async function materializeIntents(now: () => Date, summary: TickSummary) {
    const posts = await prisma.scheduledPost.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now() }, publishIntents: { none: { generation: 1 } }, ...after("scheduledAt", postCursor) },
      select: { id: true, scheduledAt: true },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: config.batchSize,
    });
    postCursor = advance(posts, config.batchSize, (row) => row.scheduledAt);
    for (const post of posts) {
      if (stopping) return;
      try {
        const intent = await ensureScheduledPublishIntent(post.id);
        summary.intentsCreated++;
        log("info", { event: "intent_ready", scheduledPostId: post.id, intentId: intent.id, state: intent.state });
      } catch (error) {
        // Onay/sürüm/hesap/medya ön koşulu tutmuyor: snapshot uydurulmaz, satır atlanır ve imleç ilerler.
        summary.invalid++;
        log("warn", { event: "intent_rejected", scheduledPostId: post.id, category: errorCategory(error) });
      }
    }
  }

  async function candidates(now: () => Date) {
    const nowDate = now();
    const notIn = deferredIds(nowDate.getTime());
    const excluded = notIn.length ? { id: { notIn } } : {};
    const pending = await prisma.publishIntent.findMany({
      where: { state: "PENDING", invalidatedAt: null, dueAt: { lte: nowDate }, ...excluded, ...after("dueAt", pendingCursor) },
      select: { id: true, dueAt: true },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: config.batchSize,
    });
    pendingCursor = advance(pending, config.batchSize, (row) => row.dueAt);
    const retry = await prisma.publishIntent.findMany({
      where: { state: "RETRY_WAIT", invalidatedAt: null, nextAttemptAt: { lte: nowDate }, ...excluded, ...after("nextAttemptAt", retryCursor) },
      select: { id: true, nextAttemptAt: true },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: config.batchSize,
    });
    retryCursor = advance(retry, config.batchSize, (row) => row.nextAttemptAt);
    return [...pending.map((row) => row.id), ...retry.map((row) => row.id)];
  }

  async function dispatchOne(intentId: string, now: () => Date, summary: TickSummary) {
    const started = Date.now();
    active++;
    try {
      const result = await dispatchPublishIntentForWorker(intentId, { ...options.publish, now });
      if (result.dispatched) summary.dispatched++;
      else summary.skipped++;
      if (result.dispatched && result.state === "PUBLISHED") summary.published++;
      if (result.dispatched && result.state === "RETRY_WAIT") summary.retryWait++;
      if (result.dispatched && result.state === "FAILED") summary.failed++;
      if (result.dispatched && result.state === "UNKNOWN") summary.reconciliationRequired++;
      log(result.state === "UNKNOWN" ? "warn" : "info", { event: result.dispatched ? "dispatched" : "dispatch_skipped", intentId, attemptId: result.attemptId ?? undefined, state: result.state, dispatched: result.dispatched, durationMs: Date.now() - started });
    } catch (error) {
      summary.errors++;
      deferred.set(intentId, now().getTime() + deferMs);
      log("warn", { event: "dispatch_refused", intentId, category: errorCategory(error), durationMs: Date.now() - started, retryInMs: deferMs });
    } finally {
      active--;
    }
  }

  async function tick(): Promise<TickSummary> {
    const summary = emptySummary();
    const now = await tickClock();
    await recoverExpired(now, summary);
    if (!stopping) await materializeIntents(now, summary);
    const queue = stopping ? [] : await candidates(now);
    summary.due = queue.length;
    // Sınırlı eşzamanlı sağlayıcı çağrısı; kapanış başladıysa yeni talep yapılmaz.
    const lanes = Array.from({ length: Math.min(config.concurrency, queue.length) }, async () => {
      for (;;) {
        if (stopping) return;
        const next = queue.shift();
        if (!next) return;
        await dispatchOne(next, now, summary);
      }
    });
    await Promise.all(lanes);
    log(summary.errors ? "warn" : "info", { event: "tick", ...summary });
    return summary;
  }

  function pause(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = done;
    });
  }

  async function loop() {
    let backoff = 0;
    while (!stopping) {
      try {
        await tick();
        backoff = 0;
      } catch (error) {
        // Veritabanı bağlantısı kopması vb.: üstel geri çekilme; havuz yeniden bağlanır.
        backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : 1_000);
        log("error", { event: "tick_failed", category: errorCategory(error), retryInMs: backoff });
      }
      if (!stopping) await pause(backoff || config.intervalMs);
    }
  }

  return {
    workerId,
    get stopping() {
      return stopping;
    },
    get activeJobs() {
      return active;
    },
    tick,
    run() {
      if (!running) {
        const configured = (load: () => unknown) => {
          try {
            return Boolean(load());
          } catch {
            return false;
          }
        };
        const meta = configured(loadMetaConfig) && configured(loadCredentialKeyring);
        const delivery = configured(loadMediaDeliveryConfig);
        log(meta ? "info" : "warn", { event: "worker_started", metaConfigured: meta, mediaDeliveryConfigured: delivery });
        running = loop();
      }
      return running;
    },
    async stop() {
      stopping = true;
      wake?.();
      if (!running) return { drained: active === 0 };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), config.shutdownTimeoutMs)));
      const outcome = await Promise.race([running.then(() => "done" as const), timeout]);
      clearTimeout(timer);
      const drained = outcome === "done" && active === 0;
      log(drained ? "info" : "warn", { event: "worker_stopped", drained });
      return { drained };
    },
  };
}
