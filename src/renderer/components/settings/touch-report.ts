// Touchscreen diagnostic (Settings › Display › Touchscreens): pure helpers.

/** A report line worth the operator's attention (the helper marks them with ⚠ or NONE) */
export function isWarningLine(line: string): boolean {
  return line.includes('⚠') || /\bNONE\b/.test(line)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** File name on the USB stick: PhotonBoard-diagnostic-tactile-<yyyy-mm-dd-hhmm>.txt (local time) */
export function touchReportFileName(date: Date = new Date()): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `PhotonBoard-diagnostic-tactile-${stamp}.txt`
}
