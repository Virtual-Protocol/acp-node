export function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

export function preparePayload(payload: string | object) {
  return typeof payload === "string"
      ? payload
      : JSON.stringify(payload);
}
