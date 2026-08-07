// Minimal Web MIDI typings when lib.dom is incomplete for this API.

interface MIDIOptions {
  sysex?: boolean
}

interface MIDIPort {
  readonly id: string
  readonly name: string | null
  readonly state: 'connected' | 'disconnected' | 'pending'
  readonly type: string
}

interface MIDIInput extends MIDIPort {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null
}

interface MIDIOutput extends MIDIPort {}

interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array | null
}

interface MIDIConnectionEvent extends Event {
  readonly port: MIDIPort
}

interface MIDIAccess extends EventTarget {
  readonly inputs: Map<string, MIDIInput>
  readonly outputs: Map<string, MIDIOutput>
  onstatechange: ((event: MIDIConnectionEvent) => void) | null
}

interface Navigator {
  requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>
}
