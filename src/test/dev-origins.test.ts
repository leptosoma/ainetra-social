import { describe, expect, it } from "vitest";
import { devOriginHosts } from "@/lib/dev-origins";

describe("Desktop calendar render regression: dev origins", () => {
  it("allows the configured public app and Meta redirect hosts so the client bundle hydrates", () => {
    expect(devOriginHosts({
      PUBLIC_APP_URL: "https://ainetra.example-tunnel.dev",
      META_REDIRECT_URI: "https://callbacks.example.dev/integrations/meta/callback",
    })).toEqual(["ainetra.example-tunnel.dev", "callbacks.example.dev"]);
  });

  it("ignores port and path and lists a shared host once", () => {
    expect(devOriginHosts({
      PUBLIC_APP_URL: "http://192.168.1.20:3001",
      META_REDIRECT_URI: "http://192.168.1.20:3001/integrations/meta/callback",
    })).toEqual(["192.168.1.20"]);
  });

  it("adds nothing for empty, invalid or localhost values", () => {
    expect(devOriginHosts({})).toEqual([]);
    expect(devOriginHosts({ PUBLIC_APP_URL: "", META_REDIRECT_URI: "not a url" })).toEqual([]);
    expect(devOriginHosts({ PUBLIC_APP_URL: "http://localhost:3001" })).toEqual([]);
  });
});
