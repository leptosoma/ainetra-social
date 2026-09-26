// Masaüstü takvim regresyonu için tarayıcı kontrolü: soğuk masaüstü yüklemesinde FullCalendar
// hiçbir yeniden boyutlandırma olmadan kurulmalıdır. Masaüstü kontrolleri ASLA önce telefon
// genişliğinde açmaz ya da kırılma noktasını geçmez; aksi hâlde hata gizlenir.
//
// Çalıştırma (uygulama çalışırken, seed verisiyle):
//   npm i --no-save playwright-core
//   BASE_URL=http://127.0.0.1:3001 CHROMIUM_PATH=/path/to/chromium node scripts/calendar-browser-check.mjs
// İsteğe bağlı: CAL_EMAIL, CAL_PASSWORD (varsayılan seed sahibi), CAL_DATE (dolu dönem),
// CAL_EMPTY_DATE (olaysız dönem).
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const email = process.env.CAL_EMAIL ?? "owner@mimoza.test";
const password = process.env.CAL_PASSWORD ?? "Ainetra123!";
const date = process.env.CAL_DATE ?? new Date().toISOString().slice(0, 10);
const emptyDate = process.env.CAL_EMPTY_DATE ?? "2031-03-12";

const fcViews = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth", year: "multiMonthYear" };
const labels = { day: "Gün", week: "Hafta", month: "Ay", year: "Yıl" };
let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// Oturum çerezi ayrı bir bağlamda alınır; denetlenen sayfa yalnızca çerezi devralır.
async function session() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/sign-in`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/sign-in")), page.click('button[type="submit"]')]);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

function grid(page) {
  return page.evaluate(() => ({
    desktopQuery: window.matchMedia("(min-width: 821px)").matches,
    fc: Boolean(document.querySelector(".fc")),
    view: document.querySelector(".fc-view")?.className.match(/fc-(\w+)-view/)?.[1] ?? null,
    slots: document.querySelectorAll(".fc-timegrid-slot-lane").length,
    columns: document.querySelectorAll(".fc-timegrid-col:not(.fc-timegrid-axis)").length,
    dayCells: document.querySelectorAll(".fc-daygrid-day").length,
    months: document.querySelectorAll(".fc-multimonth-month").length,
    height: Math.round(document.querySelector(".fc")?.getBoundingClientRect().height ?? 0),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
}

function gridMatches(view, g) {
  const cells = {
    day: g.slots === 24 && g.columns === 1,
    week: g.slots === 24 && g.columns === 7,
    month: g.dayCells === 42,
    year: g.months === 12 && g.dayCells >= 12 * 28,
  }[view];
  return g.desktopQuery && g.fc && g.view === fcViews[view] && cells && g.height > 200 && g.overflow <= 0;
}

async function waitForView(page, view) {
  await page.waitForFunction((name) => document.querySelector(".fc-view")?.classList.contains(`fc-${name}-view`), fcViews[view], { timeout: 15000 }).catch(() => {});
}

const storageState = await session();
const errors = [];

for (const width of [1440, 821]) {
  // Genişlik gezinmeden ÖNCE ayarlanır ve sonrasında hiç değiştirilmez.
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, storageState });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${width}px ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match|Uncaught|TypeError|FullCalendar/i.test(message.text())) errors.push(`${width}px ${message.text().slice(0, 200)}`);
  });

  for (const [label, day] of [["populated", date], ["empty", emptyDate]]) {
    for (const view of ["day", "week", "month", "year"]) {
      await page.goto(`${base}/calendar?view=${view}&date=${day}`);
      await waitForView(page, view);
      const g = await grid(page);
      check(`${width}px cold ${label} ${view}`, gridMatches(view, g), gridMatches(view, g) ? undefined : g);
    }
  }

  await page.goto(`${base}/calendar?view=day&date=${date}`);
  await waitForView(page, "day");
  for (const view of ["week", "month", "year", "day"]) {
    await page.locator(".calendar-views a", { hasText: labels[view] }).first().click();
    await page.waitForURL((url) => url.searchParams.get("view") === view);
    await waitForView(page, view);
    const g = await grid(page);
    check(`${width}px switch → ${view}`, gridMatches(view, g), gridMatches(view, g) ? undefined : g);
  }

  await page.reload();
  await waitForView(page, "day");
  const reloaded = await grid(page);
  check(`${width}px hard reload day`, gridMatches("day", reloaded), gridMatches("day", reloaded) ? undefined : reloaded);
  await ctx.close();
}

for (const width of [820, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, storageState });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${width}px ${error.message}`));
  for (const view of ["day", "3day", "week", "month"]) {
    await page.goto(`${base}/calendar?m=${view}&date=${date}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const s = await page.evaluate(() => ({
      fc: Boolean(document.querySelector(".fc")),
      mobileCalendar: getComputedStyle(document.querySelector(".mobile-calendar")).display,
      desktopToolbar: getComputedStyle(document.querySelector(".desktop-only")).display,
      active: document.querySelector(".mobile-calendar-views a.active")?.textContent ?? null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const ok = !s.fc && s.mobileCalendar !== "none" && s.desktopToolbar === "none" && Boolean(s.active) && s.overflow <= 0;
    check(`${width}px mobile ${view}`, ok, ok ? undefined : s);
  }
  await ctx.close();
}

check("no hydration/runtime console errors", errors.length === 0, errors.length ? errors : undefined);
await browser.close();
console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
