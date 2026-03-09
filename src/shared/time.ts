export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

export function addMs(iso: string, deltaMs: number): string {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

export function diffMs(fromIso: string, toIso: string): number {
  return new Date(toIso).getTime() - new Date(fromIso).getTime();
}
