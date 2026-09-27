export type Observation = {
  "@iot.id": number;
  phenomenonTime: string;
  result: number;
};

function isObservation(value: unknown): value is Observation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return Number.isSafeInteger(item["@iot.id"]) &&
    typeof item.phenomenonTime === "string" &&
    Number.isFinite(Date.parse(item.phenomenonTime)) &&
    typeof item.result === "number" && Number.isFinite(item.result);
}

export async function getObservations(
  datastreamId: number,
  limit = 60,
  signal?: AbortSignal,
): Promise<Observation[]> {
  const baseUrl = process.env.NEXT_PUBLIC_STA_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl || !/^(https?:\/\/|\/)/.test(baseUrl)) {
    throw new Error("NEXT_PUBLIC_STA_BASE_URL must be an HTTP(S) URL or a /path");
  }
  if (!Number.isSafeInteger(datastreamId) || datastreamId <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Invalid Datastream ID or query limit");
  }
  const query = new URLSearchParams({
    "$select": "@iot.id,phenomenonTime,result",
    "$orderby": "phenomenonTime desc,@iot.id desc",
    "$top": String(limit),
  });
  const response = await fetch(
    `${baseUrl}/Datastreams(${datastreamId})/Observations?${query}`,
    { cache: "no-store", signal },
  );

  if (!response.ok) {
    throw new Error(`STA request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null || !("value" in data) ||
      !Array.isArray(data.value) || !data.value.every(isObservation)) {
    throw new Error("Unexpected STA response: expected numeric observations with instant timestamps");
  }
  return data.value.reverse();
}
