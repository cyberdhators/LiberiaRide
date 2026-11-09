// Isolated tests with a mocked fetch (no credits spent). Fixtures follow the
// documented package and the live address response captured on 9 Nov 2026.
import { describe, expect, it, vi } from "vitest";
import { QlsClient, type QlsCallRecord } from "./client";
import { QlsError } from "./errors";
import { extractPoint, isValidAddressQuery, parseDirections, sanitizeAddress } from "./parse";
import {
  normalizePingInput,
  QLSAddressProvider,
  QLSGeocodingProvider,
  QLSLocationProvider,
  QLSRoutingProvider,
} from "./providers";
import { decodePolyline } from "../adapters/map-render";

const LIVE_ADDRESS_ROW = {
  id: "5afff7db-08b1-40b0-990e-159ef0900ab2",
  userId: "0217c424-6b52-4e2c-9c6d-a6d8eb2f07d4",
  projectId: null,
  addressSource: "qls",
  sourceId: "LI-MON-MON-1848-RF86223M",
  formattedAddress: "1848 Capitol Hill, Monrovia, Montserrado, Liberia, 5356-6780",
  buildingNumber: "1848",
  streetName: "Capitol Hill",
  city: "Monrovia",
  district: "Capitol Hill",
  county: "Greater Monrovia",
  state: "Montserrado",
  country: "Liberia",
  postalCode: "0000",
  zipcode: "5356-6780",
  latitude: 6.3002321,
  longitude: -10.798322,
  structureType: "Government",
  additionalInfo: "Executive Mansion",
  geobloc: "5133-0703",
  geoblocId: "6CRF8622",
  validationStatus: "validated",
  createdByUser: { email: "internal@example.com" },
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function client(fetchImpl: ReturnType<typeof mockFetch>, calls: QlsCallRecord[] = []) {
  return new QlsClient({ apiKey: "qls_test", fetchImpl: fetchImpl as unknown as typeof fetch, onCall: (r) => void calls.push(r) });
}

describe("QlsClient", () => {
  it("sends key, content type and POST to the documented path", async () => {
    const f = mockFetch(200, { data: [LIVE_ADDRESS_ROW], meta: { count: 1 } });
    await new QLSAddressProvider(client(f)).searchAddresses("Capitol Hill, Monrovia", 10);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://qls-global-api-15562653385.europe-west1.run.app/api/v1/search/addresses");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("qls_test");
    expect(headers["x-qls-country-id"]).toBe("0b2f0b78-152d-408d-b357-1af1ae4d2a49");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "Capitol Hill, Monrovia", limit: 10 });
  });

  it("refuses to call without a key", async () => {
    const c = new QlsClient({ apiKey: undefined });
    await expect(new QLSGeocodingProvider(c).searchPlace("Capitol Building")).rejects.toMatchObject({ code: "not_configured" });
  });

  it("maps api_inactive (credits exhausted) to a service-unavailable error, not billed", async () => {
    const calls: QlsCallRecord[] = [];
    const f = mockFetch(403, { error: { code: "api_inactive", message: "Your API is inactive…", details: null, requestId: null } });
    const err = await new QLSGeocodingProvider(client(f, calls)).searchPlace("Capitol Building").catch((e) => e);
    expect(err).toBeInstanceOf(QlsError);
    expect(err.code).toBe("api_inactive");
    expect(err.isServiceUnavailable).toBe(true);
    expect(calls[0]).toMatchObject({ httpStatus: 403, billed: false });
  });

  it("records place_not_found as billed and returns null", async () => {
    const calls: QlsCallRecord[] = [];
    const f = mockFetch(404, { error: { code: "place_not_found", message: "No place in the selected country matched.", details: null, requestId: "r1" } });
    expect(await new QLSGeocodingProvider(client(f, calls)).searchPlace("Capitol Building")).toBeNull();
    expect(calls[0]).toMatchObject({ billed: true, errorCode: "place_not_found" });
    expect(f).toHaveBeenCalledTimes(1); // 404 is not retried
  });

  it("retries once on 5xx for idempotent lookups", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      return n === 1
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ data: { source: "place", name: "ELWA Junction", placeId: "p1", label: "Paynesville", latitude: 6.24, longitude: -10.70 } }), { status: 200 });
    });
    const place = await new QLSGeocodingProvider(client(f as never)).searchPlace("ELWA Junction");
    expect(f).toHaveBeenCalledTimes(2);
    expect(place?.qlsRef).toBe("p1");
  });
});

describe("address search", () => {
  it("parses the live row shape and strips internal fields", async () => {
    const f = mockFetch(200, { data: [LIVE_ADDRESS_ROW], meta: { count: 1 } });
    const [row] = await new QLSAddressProvider(client(f)).searchAddresses("Capitol Hill, Monrovia");
    expect(row!.point).toEqual({ lat: 6.3002321, lng: -10.798322 });
    expect(row!.qlsRef).toBe("LI-MON-MON-1848-RF86223M");
    expect(row!.label).toContain("1848 Capitol Hill");
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("internal@example.com");
    expect(serialized).not.toContain("0217c424");
  });

  it("validates the street, city shape before spending a credit", async () => {
    const f = mockFetch(200, { data: [] });
    await expect(new QLSAddressProvider(client(f)).searchAddresses("Monrovia")).rejects.toMatchObject({ code: "bad_request" });
    expect(f).not.toHaveBeenCalled();
    expect(isValidAddressQuery("123 Main St, Anycity, AC")).toBe(true);
    expect(isValidAddressQuery("A, Monrovia")).toBe(false);
  });

  it("sanitizeAddress keeps only allow-listed fields", () => {
    expect(Object.keys(sanitizeAddress(LIVE_ADDRESS_ROW)).sort()).toEqual(
      ["additionalInfo", "city", "country", "county", "district", "formattedAddress", "buildingNumber", "geobloc",
       "postalCode", "state", "streetName", "structureType", "validationStatus", "zipcode"].sort(),
    );
  });
});

describe("ping", () => {
  it("accepts share links and bare ids", () => {
    expect(normalizePingInput("https://quantumloc.io/p/abc123xyz")).toBe("abc123xyz");
    expect(normalizePingInput("abc123xyz")).toBe("abc123xyz");
    expect(normalizePingInput("not a pin!")).toBeNull();
  });

  it("surfaces ping_inactive", async () => {
    const f = mockFetch(409, { error: { code: "ping_inactive", message: "This Ping is off. A ride cannot start." } });
    await expect(new QLSLocationProvider(client(f)).resolvePing("abc123xyz")).rejects.toMatchObject({ code: "ping_inactive" });
  });

  it("never sends pickup and dropoff together", async () => {
    const f = mockFetch(200, { data: { kilometers: 1.204, miles: 0.748, role: "pickup" } });
    const r = await new QLSLocationProvider(client(f)).driverDistance({ lat: 6.3, lng: -10.8 }, { lat: 6.31, lng: -10.79 }, "pickup");
    expect(r.kilometers).toBe(1.204);
    const body = JSON.parse(String(f.mock.calls[0]![1]?.body));
    expect(Object.keys(body).sort()).toEqual(["driver", "pickup"]);
  });
});

describe("directions", () => {
  const OK = {
    status: "OK", mode: "driving", originLabel: "A", destinationLabel: "B", distanceText: "1.2 km",
    durationText: "4 mins", distanceMeters: 1200, durationSeconds: 240, crossBorder: false,
    steps: [{ instruction: "Head north on Capitol Hill", distanceText: "200 m", durationText: "1 min", maneuver: "straight" }],
  };

  it("parses an OK route", () => {
    const r = parseDirections(OK)!;
    expect(r.distanceMeters).toBe(1200);
    expect(r.steps[0]!.instruction).toContain("Head north");
  });

  it("reads the live response shape (overviewPolyline, step start/end)", () => {
    const live = { ...OK, overviewPolyline: "_p~iF~ps|U_ulLnnqC", bounds: { northeast: { lat: 6.3, lng: -10.69 }, southwest: { lat: 6.24, lng: -10.79 } },
      steps: [{ instruction: "Head southeast toward Camp Johnson Rd", distanceText: "0.2 km", durationText: "1 min", maneuver: null,
        start: { lat: 6.3002, lng: -10.7983 }, end: { lat: 6.299, lng: -10.797 } }],
      googleMapsUrl: "https://example.invalid" };
    const r = parseDirections(live)!;
    expect(r.polyline).toBe("_p~iF~ps|U_ulLnnqC");
    expect(r.steps[0]!.point).toEqual({ lat: 6.3002, lng: -10.7983 });
  });

  it("returns null for a non-OK or empty route (credit refunded by QLS)", () => {
    expect(parseDirections({ ...OK, status: "ZERO_RESULTS" })).toBeNull();
    expect(parseDirections({ ...OK, steps: [] })).toBeNull();
  });

  it("sums multi-leg routes", async () => {
    const f = mockFetch(200, { data: OK });
    const r = await new QLSRoutingProvider(client(f)).multiLeg([{ lat: 6.3, lng: -10.8 }, { lat: 6.31, lng: -10.79 }, { lat: 6.32, lng: -10.78 }]);
    expect(r?.distanceMeters).toBe(2400);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("point extraction", () => {
  it.each([
    [{ latitude: 6.3, longitude: -10.8 }],
    [{ lat: 6.3, lng: -10.8 }],
    [{ location: { latitude: 6.3, longitude: -10.8 } }],
    [{ point: { lat: "6.3", lng: "-10.8" } }],
    [{ geometry: { coordinates: [-10.8, 6.3] } }],
    [{ coordinates: [-10.8, 6.3] }],
  ])("accepts %j", (shape) => {
    expect(extractPoint(shape)).toEqual({ lat: 6.3, lng: -10.8 });
  });

  it("rejects missing, out-of-range and null-island coordinates", () => {
    expect(extractPoint({})).toBeNull();
    expect(extractPoint({ latitude: 95, longitude: 0 })).toBeNull();
    expect(extractPoint({ latitude: 0, longitude: 0 })).toBeNull();
  });
});

describe("polyline", () => {
  it("decodes the reference example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252],
    ]);
  });
});
