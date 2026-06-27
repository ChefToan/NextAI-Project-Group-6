// Display helpers for Group 6 product naming (shared server/client).

export function shortProduct(name: string): string {
  return name
    .replace(/^NextAI\s+Odd?[iy]ss?ey\s+/i, "")
    .replace(/\s*Group\s*6\s*$/i, "")
    .trim();
}

export function modelOf(name: string): "3.0" | "3.5" {
  return /3\.5/.test(name) ? "3.5" : "3.0";
}

export function modelTagClass(model: string): string {
  return model === "3.5" ? "tag tag-35" : "tag tag-30";
}
