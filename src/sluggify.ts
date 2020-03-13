export function sluggify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .substr(0, 60);
}
