// Slot-based sample playback for the workstation panel.
//
// Boundary rule borrowed from the Ambient Live engine (plan KTD-8): this module
// owns the whole audio stack and knows nothing about React, rpc, or bb. The UI
// calls methods; nothing here reads plugin state.
//
// v0 uses plain Web Audio per slot. Routing slots through the C++ Dattorro
// plate in engine.wasm is the next slice — it needs a multi-slot sample voice
// in the core first.

export interface SlotHandle {
  /** Fires when a source ends on its own so the UI can drop its playing flag. */
  onEnded: () => void;
}

export class SamplePlayer {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly meterBuffer: Float32Array;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly sources = new Map<number, AudioBufferSourceNode>();
  private readonly gains = new Map<number, GainNode>();

  private constructor(context: AudioContext) {
    this.context = context;
    this.master = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meterBuffer = new Float32Array(this.analyser.fftSize);
    this.master.connect(this.analyser);
    this.analyser.connect(context.destination);
  }

  // Must be called from a user gesture so the AudioContext can start.
  static async start(): Promise<SamplePlayer> {
    const context = new AudioContext();
    await context.resume();
    return new SamplePlayer(context);
  }

  // Decode and commit are separate so callers can drop a stale decode before it
  // overwrites a newer load on the same slot.
  async decode(encoded: ArrayBuffer): Promise<AudioBuffer> {
    return this.context.decodeAudioData(encoded);
  }

  setSlotBuffer(slot: number, buffer: AudioBuffer): void {
    this.stopSlot(slot);
    this.buffers.set(slot, buffer);
  }

  clearSlot(slot: number): void {
    this.stopSlot(slot);
    this.buffers.delete(slot);
    this.gains.get(slot)?.disconnect();
    this.gains.delete(slot);
  }

  hasSlot(slot: number): boolean {
    return this.buffers.has(slot);
  }

  durationOf(slot: number): number {
    return this.buffers.get(slot)?.duration ?? 0;
  }

  playSlot(slot: number, options: { loop: boolean; gain: number }, handle: SlotHandle): void {
    const buffer = this.buffers.get(slot);
    if (!buffer) return;

    this.stopSlot(slot);

    const gainNode = this.gainFor(slot);
    gainNode.gain.value = options.gain;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop;
    source.connect(gainNode);
    source.onended = () => {
      // A stopSlot() replacement already cleared the map entry; only report an
      // end that still belongs to the live source.
      if (this.sources.get(slot) !== source) return;
      this.sources.delete(slot);
      handle.onEnded();
    };
    source.start();
    this.sources.set(slot, source);
  }

  setSlotLoop(slot: number, loop: boolean): void {
    const source = this.sources.get(slot);
    if (source) source.loop = loop;
  }

  stopSlot(slot: number): void {
    const source = this.sources.get(slot);
    if (!source) return;
    this.sources.delete(slot);
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  stopAll(): void {
    for (const slot of Array.from(this.sources.keys())) this.stopSlot(slot);
  }

  setSlotGain(slot: number, gain: number): void {
    this.gainFor(slot).gain.value = gain;
  }

  setMasterGain(gain: number): void {
    this.master.gain.value = gain;
  }

  /** Peak of the current analyser frame, 0..1 — the UI's output meter. */
  outputLevel(): number {
    this.analyser.getFloatTimeDomainData(this.meterBuffer as Float32Array<ArrayBuffer>);
    let peak = 0;
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const magnitude = Math.abs(this.meterBuffer[i]!);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  async close(): Promise<void> {
    this.stopAll();
    await this.context.close();
  }

  private gainFor(slot: number): GainNode {
    const existing = this.gains.get(slot);
    if (existing) return existing;
    const gainNode = this.context.createGain();
    gainNode.connect(this.master);
    this.gains.set(slot, gainNode);
    return gainNode;
  }
}
