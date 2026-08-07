export const SAMPLE_DRAG_MIME = 'application/x-ambient-sample'

export interface SampleDragPayload {
  sampleId: number
  name: string
  url: string
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
    return { sampleId, name, url }
  } catch {
    return null
  }
}

export function setSampleDragData(dataTransfer: DataTransfer, payload: SampleDragPayload): void {
  const serialized = serializeSampleDrag(payload)
  dataTransfer.setData(SAMPLE_DRAG_MIME, serialized)
  // text/plain fallback helps some browsers surface the drag
  dataTransfer.setData('text/plain', serialized)
  dataTransfer.effectAllowed = 'copy'
}

export function readSampleDragData(dataTransfer: DataTransfer): SampleDragPayload | null {
  const typed = dataTransfer.getData(SAMPLE_DRAG_MIME)
  if (typed) return parseSampleDrag(typed)
  return parseSampleDrag(dataTransfer.getData('text/plain'))
}
