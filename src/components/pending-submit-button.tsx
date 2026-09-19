"use client";

import { useFormStatus } from "react-dom";

export function PendingSubmitButton({ idle, pending, className = "button primary", disabled = false }: { idle: string; pending: string; className?: string; disabled?: boolean }) {
  const status = useFormStatus();
  return <button className={className} type="submit" disabled={disabled || status.pending} aria-live="polite">{status.pending ? pending : idle}</button>;
}
