// Tests de enrichFromMetaAdLibrary (src/enrichment.js). fetch MOCKEADO — nunca
// pega a la Graph API real. Verifica: parseo con token, skips graceful (sin
// token / sin facebook / país no soportado), mapeo de país en la URL, y que
// nunca lanza.

import { describe, it, expect } from "vitest";
import { enrichFromMetaAdLibrary } from "../src/enrichment.js";

function mockFetch({ body = "", status = 200, ok = true, throwErr = null } = {}) {
  return async () => {
    if (throwErr) throw throwErr;
    return { ok, status, text: async () => body };
  };
}

const TOKEN = "TESTTOKEN123";

describe("enrichFromMetaAdLibrary (fetch MOCKEADO)", () => {
  it("con token + anuncios activos → metaAdsActive true, count y lastCreated", async () => {
    const body = JSON.stringify({
      data: [
        { id: "1", ad_creation_time: "2026-06-01" },
        { id: "2", ad_creation_time: "2026-06-20" },
        { id: "3", ad_creation_time: "2026-05-10" },
      ],
    });
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/ClinicaSonrisa", country: "España" },
      { token: TOKEN, fetchImpl: mockFetch({ body }) }
    );
    expect(r.metaAdsActive).toBe(true);
    expect(r.metaAdsCount).toBe(3);
    expect(r.metaAdsLastCreated).toBe("2026-06-20"); // el más reciente
  });

  it("sin anuncios (data vacío) → metaAdsActive false", async () => {
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/ClinicaSonrisa", country: "México" },
      { token: TOKEN, fetchImpl: mockFetch({ body: JSON.stringify({ data: [] }) }) }
    );
    expect(r.metaAdsActive).toBe(false);
    expect(r.metaAdsCount).toBe(0);
  });

  it("sin token → skip graceful 'no_token' (no rompe)", async () => {
    let fetched = false;
    const spy = async () => { fetched = true; return { ok: true, status: 200, text: async () => "{}" }; };
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/X", country: "España" },
      { token: "", fetchImpl: spy }
    );
    expect(r).toMatchObject({ metaAdsActive: false, skipped: "no_token" });
    expect(fetched).toBe(false); // no pegó a la API
  });

  it("sin facebook → skip 'no_facebook'", async () => {
    const r = await enrichFromMetaAdLibrary({ country: "España" }, { token: TOKEN, fetchImpl: mockFetch() });
    expect(r).toMatchObject({ metaAdsActive: false, skipped: "no_facebook" });
  });

  it("país no soportado → skip 'unsupported_country'", async () => {
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/X", country: "Japón" },
      { token: TOKEN, fetchImpl: mockFetch() }
    );
    expect(r).toMatchObject({ metaAdsActive: false, skipped: "unsupported_country" });
  });

  it("mapea el país al ISO2 correcto en la URL + usa el handle como search_terms", async () => {
    let calledUrl = "";
    const f = async (url) => { calledUrl = url; return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) }; };
    await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/OdontoUY", country: "Uruguay" },
      { token: TOKEN, fetchImpl: f }
    );
    expect(calledUrl).toContain("graph.facebook.com");
    expect(calledUrl).toContain("ad_active_status=ACTIVE");
    expect(decodeURIComponent(calledUrl)).toContain('ad_reached_countries=["UY"]');
    expect(decodeURIComponent(calledUrl)).toContain("search_terms=OdontoUY");
  });

  it("error de la API degrada a { error } (no lanza)", async () => {
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/X", country: "Colombia" },
      { token: TOKEN, fetchImpl: mockFetch({ body: JSON.stringify({ error: { code: 190, message: "bad token" } }) }) }
    );
    expect(r.metaAdsActive).toBe(false);
    expect(typeof r.error).toBe("string");
  });

  it("nunca lanza si fetch tira excepción", async () => {
    const r = await enrichFromMetaAdLibrary(
      { facebook: "https://facebook.com/X", country: "Chile" },
      { token: TOKEN, fetchImpl: mockFetch({ throwErr: new Error("ECONNRESET") }) }
    );
    expect(r.metaAdsActive).toBe(false);
    expect(typeof r.error).toBe("string");
  });
});
