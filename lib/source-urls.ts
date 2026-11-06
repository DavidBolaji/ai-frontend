// Link validation shared by the resolution form and the knowledge API route,
// mirroring app/schemas/knowledge_resolution.py on the backend. Stored source
// URLs are fetched server-side when an answer is assembled, so a submitted URL
// is a request the platform will make: only public named HTTPS pages are taken.

export const MAX_SOURCE_URLS = 10;
export const MAX_URL_LENGTH = 2000;

const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal']);
const PRIVATE_HOST_SUFFIXES = ['.local', '.localdomain', '.internal', '.intranet', '.home.arpa', '.cluster.local'];
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function publicHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!name || BLOCKED_HOSTS.has(name) || PRIVATE_HOST_SUFFIXES.some(suffix => name.endsWith(suffix))) return false;
  // A cited page is always a named site, so every bare address is refused —
  // one rule instead of a private-range list that has to stay complete.
  if (IPV4.test(name) || name.includes(':') || /^\d+$/.test(name)) return false;
  return name.includes('.');
}

/** The single reason a URL is unusable, or '' when it is acceptable. */
export function urlProblem(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a web address.';
  if (trimmed.length > MAX_URL_LENGTH) return `Use a URL of at most ${MAX_URL_LENGTH.toLocaleString()} characters.`;
  const unsafe = (c: string) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
  if (/\s/.test(trimmed) || Array.from(trimmed).some(unsafe))
    return 'A URL must not contain spaces or control characters.';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Enter a complete web address, for example https://www.amsterdam.nl/page.';
  }
  if (url.protocol !== 'https:') return 'Use an HTTPS address.';
  if (url.username || url.password) return 'Remove the username and password from the address.';
  if (url.port && url.port !== '443') return 'Use the standard HTTPS port.';
  if (!publicHost(url.hostname)) return 'Use a public web address, not an internal host.';
  return '';
}

export type SourceUrlResult = { urls: string[]; error: string; index: number };

/**
 * Drop blank rows, validate each remaining one, collapse duplicates and keep
 * the order the reviewer entered. `index` points at the offending row so the
 * form can mark it.
 */
export function normaliseSourceUrls(values: readonly string[]): SourceUrlResult {
  const urls: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const trimmed = (values[index] ?? '').trim();
    if (!trimmed) continue;
    const problem = urlProblem(trimmed);
    if (problem) return { urls: [], error: problem, index };
    if (!urls.includes(trimmed)) urls.push(trimmed);
  }
  if (urls.length > MAX_SOURCE_URLS) {
    return { urls: [], error: `Use at most ${MAX_SOURCE_URLS} source URLs.`, index: MAX_SOURCE_URLS };
  }
  return { urls, error: '', index: -1 };
}
