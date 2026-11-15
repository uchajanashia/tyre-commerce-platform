import assert from "node:assert/strict";
import test from "node:test";

import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";

import { FitmentUpstreamError } from "./fitment-upstream.error";
import { WheelSizeClientService } from "./wheel-size-client.service";

function response<T>(data: T) {
  return {
    data: { data },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  } as any;
}

test("incomplete load/speed requirements are rejected instead of fabricated", async () => {
  const http = {
    get: () =>
      of(
        response([
          {
            slug: "unsafe-trim",
            name: "Unsafe trim",
            wheels: [
              {
                is_stock: true,
                front: {
                  rim_diameter: 18,
                  tire_width: 225,
                  tire_aspect_ratio: 45,
                },
              },
            ],
          },
        ]),
      ),
  } as unknown as HttpService;
  const client = new WheelSizeClientService(http);

  assert.deepEqual(await client.searchByModel("bmw", "3-series", 2024), []);
});

test("a transient upstream 503 is retried once and then succeeds", async () => {
  let calls = 0;
  const http = {
    get: () => {
      calls += 1;
      if (calls === 1) {
        return throwError(() => ({ response: { status: 503, headers: {} } }));
      }
      return of(response([{ slug: "bmw", name: "BMW" }]));
    },
  } as unknown as HttpService;
  const client = new WheelSizeClientService(http);

  assert.deepEqual(await client.getMakes(), [{ slug: "bmw", name: "BMW" }]);
  assert.equal(calls, 2);
});

test("a permanent upstream 401 is not retried and is exposed as sanitized 503", async () => {
  let calls = 0;
  const http = {
    get: () => {
      calls += 1;
      return throwError(() => ({ response: { status: 401, headers: {} } }));
    },
  } as unknown as HttpService;
  const client = new WheelSizeClientService(http);

  await assert.rejects(client.getMakes(), (error: unknown) => {
    assert.ok(error instanceof FitmentUpstreamError);
    assert.equal(error.upstreamStatus, 401);
    assert.equal(error.getStatus(), 503);
    return true;
  });
  assert.equal(calls, 1);
});
