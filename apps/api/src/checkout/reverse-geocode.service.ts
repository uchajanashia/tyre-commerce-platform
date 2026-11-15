import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

interface GoogleAddressComponent {
  long_name?: string;
  types?: string[];
}

interface GoogleGeocodeResult {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
}

interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
}

export interface ReverseGeocodeResult {
  city: string;
  street: string;
  formattedAddress: string;
}

@Injectable()
export class ReverseGeocodeService {
  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<ReverseGeocodeResult> {
    const apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException("Address lookup is not configured");
    }

    const url = new URL(GOOGLE_GEOCODING_URL);
    url.searchParams.set("latlng", `${latitude},${longitude}`);
    url.searchParams.set("language", "ka");
    url.searchParams.set("region", "ge");
    url.searchParams.set("key", apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new ServiceUnavailableException("Address lookup failed");

      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) {
        throw new ServiceUnavailableException("Address lookup failed");
      }
      const payload = JSON.parse(raw) as GoogleGeocodeResponse;
      if (payload.status === "ZERO_RESULTS" || !payload.results?.length) {
        throw new NotFoundException("Address was not found");
      }
      if (payload.status !== "OK") {
        throw new ServiceUnavailableException("Address lookup failed");
      }

      const result = payload.results[0];
      const components = result.address_components ?? [];
      const component = (...types: string[]) =>
        components
          .find((item) => item.types?.some((type) => types.includes(type)))
          ?.long_name?.trim() ?? "";
      const city = component(
        "locality",
        "postal_town",
        "administrative_area_level_2",
        "sublocality",
      );
      const route = component("route");
      const streetNumber = component("street_number");

      return {
        city,
        street: [route, streetNumber].filter(Boolean).join(" "),
        formattedAddress: result.formatted_address?.trim() ?? "",
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException("Address lookup failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
