"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/actions/auth";
import type { CapturePrompt } from "@/features/capture-engine/prompt";
import { BrandMark } from "./brand-mark";
import { CaptureSheet } from "./capture-sheet";
import { businessNavigation, dockNavigation, isNavigationActive } from "./navigation";

// P5.5B: yalnızca telefonda görünen gezinme (CSS ile ≤820px). Üstte ince bir başlık ve daha az
// kullanılan sayfalar için `İşletmem` menüsü; altta başparmak erişimli beş öğeli çubuk.
// Masaüstü kenar çubuğu olduğu gibi kalır.

export function MobileTopbar({ businessName, userName }: { businessName?: string; userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Başka sayfaya geçildiğinde menü kapanır (düzen bileşeni gezinmede yeniden kurulmaz).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="mobile-topbar">
      <BrandMark />
      <button
        ref={buttonRef}
        type="button"
        className="mobile-more-button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-icon" aria-hidden="true">{businessName?.slice(0, 1) ?? "+"}</span>
        İşletmem
      </button>
      <nav id={menuId} className="mobile-more-menu" hidden={!open} aria-label="İşletmem ve ayarlar">
        <p><small>Çalışma alanı</small><strong>{businessName ?? "İşletme oluştur"}</strong></p>
        <ul>
          {businessNavigation.map(({ icon, label, href }) => (
            <li key={href}>
              <Link href={href} aria-current={isNavigationActive(pathname, href) ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}</Link>
            </li>
          ))}
        </ul>
        <form action={signOutAction}><button className="text-button" type="submit">Çıkış yap ({userName})</button></form>
      </nav>
    </header>
  );
}

export function MobileDock({ businessId, prompts }: { businessId?: string; prompts: CapturePrompt[] }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const captureRef = useRef<HTMLButtonElement>(null);
  const [left, right] = [dockNavigation.slice(0, 2), dockNavigation.slice(2)];
  const hasContext = prompts.length > 0;

  const close = useCallback(() => {
    setSheetOpen(false);
    captureRef.current?.focus();
  }, []);

  const renderLink = ({ icon, label, mobileLabel, href }: (typeof dockNavigation)[number]) => {
    const active = isNavigationActive(pathname, href);
    return (
      <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{icon}</span>
        {mobileLabel ?? label}
      </Link>
    );
  };

  return (
    <>
      <nav className="mobile-dock" aria-label="Ana gezinme">
        {left.map(renderLink)}
        <button
          ref={captureRef}
          type="button"
          className="mobile-capture-button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-label={hasContext ? `Çek ve yükle: ${prompts[0].headline}` : "Çek ve yükle"}
          onClick={() => setSheetOpen(true)}
        >
          <span aria-hidden="true">＋</span>
          {hasContext && <i className="mobile-capture-dot" aria-hidden="true" />}
        </button>
        {right.map(renderLink)}
      </nav>
      <CaptureSheet open={sheetOpen} onClose={close} businessId={businessId} prompts={prompts} />
    </>
  );
}
