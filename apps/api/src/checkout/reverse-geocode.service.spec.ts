import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { ReverseGeocodeService } from "./reverse-geocode.service";

const originalFetch = globalThis.fetch;
const originalKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined)
    delete process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  else process.env.GOOGLE_MAPS_GEOCODING_API_KEY = originalKey;
});

test("reverse geocoding fails closed when the server key is missing", async () => {
  delete process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  await assert.rejects(
    () => new ReverseGeocodeService().reverse(41.715138, 44.827095),
    ServiceUnavailableException,
  );
});

test("reverse geocoding maps structured Georgian city and street components", async () => {
  process.env.GOOGLE_MAPS_GEOCODING_API_KEY = "server-only-key";
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        status: "OK",
        results: [
          {
            formatted_address:
              "12 ილია ჭავჭავაძის გამზირი, თბილისი, საქართველო",
            address_components: [
              { long_name: "12", types: ["street_number"] },
              { long_name: "ილია ჭავჭავაძის გამზირი", types: ["route"] },
              { long_name: "თბილისი", types: ["locality"] },
            ],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await new ReverseGeocodeService().reverse(
    41.715138,
    44.827095,
  );

  assert.deepEqual(result, {
    city: "თბილისი",
    street: "ილია ჭავჭავაძის გამზირი 12",
    formattedAddress: "12 ილია ჭავჭავაძის გამზირი, თბილისი, საქართველო",
  });
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.searchParams.get("language"), "ka");
  assert.equal(url.searchParams.get("region"), "ge");
  assert.equal(url.searchParams.get("key"), "server-only-key");
});
