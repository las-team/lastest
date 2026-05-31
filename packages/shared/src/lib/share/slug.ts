export function isValidShareSlug(slug: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(slug);
}
