export type OS = "mac" | "win" | "linux" | "other";

export function detectOS(): OS {
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (/mac|iphone|ipad/.test(s)) return "mac";
  if (/win/.test(s)) return "win";
  if (/linux|android/.test(s)) return "linux";
  return "other";
}
