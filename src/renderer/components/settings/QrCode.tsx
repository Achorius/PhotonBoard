// QR code as inline SVG (dark modules on a light tile so every phone
// camera reads it, whatever the UI theme).

import { memo, useMemo } from 'react'
import { cn, palette } from '@renderer/components/ui'
import { encodeQr, qrToSvgPath, type QrEcc } from './qr'
import { t } from '@renderer/i18n'

export const QrCode = memo(function QrCode({ value, size = 176, ecc = 'M', className, label }: {
  value: string
  /** Rendered width/height in CSS px */
  size?: number
  ecc?: QrEcc
  className?: string
  label?: string
}) {
  const qr = useMemo(() => {
    try { return encodeQr(value, ecc) } catch { return null }
  }, [value, ecc])
  if (!qr) return null
  const border = 3
  const dim = qr.size + border * 2
  return (
    <svg
      role="img"
      aria-label={label ?? t('settings.remoteAccess.qrAria', { value })}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('shrink-0 rounded-lg', className)}
    >
      <rect width={dim} height={dim} rx={1.2} fill={palette.fgPrimary} />
      <path d={qrToSvgPath(qr, border)} fill={palette.surface0} />
    </svg>
  )
})
