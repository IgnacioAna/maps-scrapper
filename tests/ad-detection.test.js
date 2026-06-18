// Phase 10 C6 — detección de publicidad (píxeles en el HTML). Función pura.
import { describe, it, expect } from "vitest";
import { detectAdPixels } from "../src/enrichment.js";

describe("detectAdPixels", () => {
  it("detecta Meta/Facebook pixel (fbq)", () => {
    const r = detectAdPixels("<script>fbq('init','123456789')</script>");
    expect(r.hasMetaPixel).toBe(true);
    expect(r.runsAds).toBe(true);
  });
  it("detecta Google Ads (AW-) — no confunde con GA4", () => {
    const r = detectAdPixels("<script src='https://www.googletagmanager.com/gtag/js?id=AW-123456789'></script>");
    expect(r.hasGoogleAds).toBe(true);
    expect(r.runsAds).toBe(true);
    const ga4 = detectAdPixels("<script src='gtag/js?id=G-ABC123'></script>");
    expect(ga4.hasGoogleAds).toBe(false); // GA4 analytics no es Ads
  });
  it("detecta TikTok pixel", () => {
    expect(detectAdPixels("<script>ttq.load('X')</script>").hasTikTokPixel).toBe(true);
  });
  it("HTML limpio → runsAds false", () => {
    expect(detectAdPixels("<html><body>Clínica Dental</body></html>").runsAds).toBe(false);
  });
  it("input no-string → safe (runsAds false)", () => {
    expect(detectAdPixels(null).runsAds).toBe(false);
    expect(detectAdPixels(undefined).runsAds).toBe(false);
  });
});
