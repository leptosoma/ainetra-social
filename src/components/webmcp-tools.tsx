"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

export function WebMcpTools({ businessName }: { businessName?: string }) {
  const router = useRouter();
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const common = { signal: lifecycle.signal };

    void Promise.resolve(context.registerTool({
      name: "read_ainetra_workspace",
      title: "Ainetra çalışma alanını oku",
      description: "Aktif Ainetra Social işletmesini ve kullanılabilir ana ekranları döndürür.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({ businessName: businessName ?? null, routes: ["/dashboard", "/content", "/calendar", "/media", "/brand", "/settings"] }),
    }, common)).catch(() => undefined);

    void Promise.resolve(context.registerTool({
      name: "start_content_creation",
      title: "İçerik oluşturmayı başlat",
      description: "Ainetra Social içerik stüdyosunu yeni içerik formunda açar; henüz kayıt oluşturmaz.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        router.push("/content#new-content");
        return { status: "navigating", destination: "/content#new-content" };
      },
    }, common)).catch(() => undefined);

    return () => lifecycle.abort();
  }, [businessName, router]);

  return null;
}
