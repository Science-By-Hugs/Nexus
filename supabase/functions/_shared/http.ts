// Parses a JSON response body, returning null when the body is not JSON
// (for example an HTML error page from an upstream proxy).
export async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
