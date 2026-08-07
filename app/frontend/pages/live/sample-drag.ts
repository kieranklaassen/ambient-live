export const SAMPLE_DRAG_MIME = 'application/x-ambient-sample'

export interface SampleDragPayload {
  sampleId: number
  name: string
  url: string
}

/** Same-origin http(s)/relative paths and blob: URLs only — rejects cross-origin drag forgery. */
export function isAllowedSampleUrl(url: string, origin: string = defaultOrigin()): boolean {
  if (url.startsWith('blob:')) return true
  // Root-relative same-origin path (reject protocol-relative //evil.example)
  if (url.startsWith('/') && !url.startsWith('//')) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!origin) return false
    return parsed.origin === origin
  } catch {
    return false
  }
}

function defaultOrigin(): string {
  if (typeof window === 'undefined' || !window.location?.origin) return ''
  return window.location.origin
}

export function serializeSampleDrag(payload: SampleDragPayload): string {
  return JSON.stringify(payload)
}

export function parseSampleDrag(raw: string | null | undefined): SampleDragPayload | null {
  if (raw == null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const sampleId = record.sampleId
    const name = record.name
    const url = record.url
    if (typeof sampleId !== 'number' || !Number.isFinite(sampleId)) return null
    if (typeof name !== 'string' || typeof url !== 'string') return null
    if (!isAllowedSampleUrl(url)) return null
    return { sampleId, name, url }
  } catch {
    return null
  }
}

export function setSampleDragData(dataTransfer: DataTransfer, payload: SampleDragPayload): void {
  const serialized = serializeSampleDrag(payload)
  dataTransfer.setData(SAMPLE_DRAG_MIME, serialized)
  // text/plain helps some browsers surface the drag; readers must not trust it alone
  dataTransfer.setData('text/plain', serialized)
  dataTransfer.effectAllowed = 'copy'
}

export function readSampleDragData(dataTransfer: DataTransfer): SampleDragPayload | null {
  // Only the typed MIME — never text/plain, which any page can forge on drop.
  return parseSampleDrag(dataTransfer.getData(SAMPLE_DRAG_MIME))
}
