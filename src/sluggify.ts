export function sluggify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .substring(0, 60);
}
