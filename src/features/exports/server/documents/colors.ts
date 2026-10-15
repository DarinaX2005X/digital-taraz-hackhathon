export interface ExportColor { hex: string; alpha: number }
export function exportColor(value: unknown): ExportColor | undefined {
  if (value === 'transparent') return { hex: '000000', alpha: 0 };
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return undefined;
  let hex = value.slice(1); if (hex.length <= 4) hex = [...hex].map((character) => character + character).join('');
  return { hex: hex.slice(0, 6), alpha: hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1 };
}
export function flattenColor(color: ExportColor, background = 'FFFFFF'): string {
  return [0, 2, 4].map((offset) => Math.round(Number.parseInt(color.hex.slice(offset, offset + 2), 16) * color.alpha + Number.parseInt(background.slice(offset, offset + 2), 16) * (1 - color.alpha)).toString(16).padStart(2, '0')).join('');
}
