"use client";

import { useFormStatus } from "react-dom";

export function PendingSubmitButton({ idle, pending, className = "button primary" }: { idle: string; pending: string; className?: string }) {
  const status = useFormStatus();
  return <button className={className} type="submit" disabled={status.pending} aria-live="polite">{status.pending ? pending : idle}</button>;
}
