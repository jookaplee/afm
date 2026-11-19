/** wa.me link for a Malaysian phone number ("012-345 6789" -> https://wa.me/60123456789). */
export function waLink(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const intl = digits.startsWith('60') ? digits : digits.startsWith('0') ? `6${digits}` : `60${digits}`;
  return `https://wa.me/${intl}`;
}

export function telLink(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 8 ? `tel:${digits}` : null;
}

/** Social links stored as JSON on an account; only http(s) URLs are returned. */
export function socialLinks(json: string | null | undefined): { key: string; url: string }[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return Object.entries(obj)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && /^https?:\/\//i.test(e[1]))
      .map(([key, url]) => ({ key, url }));
  } catch {
    return [];
  }
}
