// bb-plugin-ambient-live — the workstation panel.
//
// Left: the local sample browser, served over bb.sdk.files so a remote host's
// folder browses like a local one. Right: the player area — drag a sample onto
// a slot and trigger it. Ableton's browser-then-rack gesture, minus the grid.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { SamplePlayer } from "./audio/sample-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SLOT_COUNT = 8;
const DRAG_MIME = "application/x-ambient-sample";

interface BrowseEntry {
  path: string;
  name: string;
  folder: string;
}

interface Slot {
  path: string | null;
  name: string | null;
  duration: number;
  gain: number;
  loop: boolean;
  playing: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_SLOT: Slot = {
  path: null,
  name: null,
  duration: 0,
  gain: 0.8,
  loop: false,
  playing: false,
  loading: false,
  error: null,
};

function encodePreviewPath(baseUrl: string, relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean).map(encodeURIComponent);
  return `${baseUrl.replace(/\/$/, "")}/${segments.join("/")}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Workstation() {
  const rpc = useRpc<typeof rpcContract>();

  const playerRef = useRef<SamplePlayer | null>(null);
  const previewBaseRef = useRef<string | null>(null);

  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [slots, setSlots] = useState<Slot[]>(() =>
    Array.from({ length: SLOT_COUNT }, () => ({ ...EMPTY_SLOT })),
  );
  const [started, setStarted] = useState(false);
  const [masterGain, setMasterGain] = useState(0.8);
  const [level, setLevel] = useState(0);
  const [dragSlot, setDragSlot] = useState<number | null>(null);

  const updateSlot = useCallback((index: number, patch: Partial<Slot>) => {
    setSlots((previous) =>
      previous.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  }, []);

  // Browser listing — debounced so typing does not fan out one rpc per keystroke.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void rpc
        .call("browse", { query })
        .then((result) => {
          if (cancelled) return;
          setEntries(result.entries);
          setRoot(result.root);
          setTruncated(result.truncated);
          setBrowseError(result.error);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setBrowseError(error instanceof Error ? error.message : String(error));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, rpc]);

  useEffect(() => {
    return () => {
      void playerRef.current?.close();
      playerRef.current = null;
    };
  }, []);

  // Output meter, quantized so idle frames re-render nothing.
  useEffect(() => {
    if (!started) return;
    let frame = 0;
    const poll = () => {
      const player = playerRef.current;
      if (player) setLevel(Math.round(player.outputLevel() * 200) / 200);
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [started]);

  // The AudioContext needs a gesture; every entry point routes through here.
  const ensurePlayer = useCallback(async (): Promise<SamplePlayer> => {
    const existing = playerRef.current;
    if (existing) return existing;
    const player = await SamplePlayer.start();
    player.setMasterGain(masterGain);
    playerRef.current = player;
    setStarted(true);
    return player;
  }, [masterGain]);

  // Preview URLs expire, so a stale base refetches once before failing.
  const fetchSample = useCallback(
    async (relativePath: string): Promise<ArrayBuffer> => {
      const attempt = async (baseUrl: string) => {
        const response = await fetch(encodePreviewPath(baseUrl, relativePath));
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      };

      if (previewBaseRef.current) {
        try {
          return await attempt(previewBaseRef.current);
        } catch {
          previewBaseRef.current = null;
        }
      }

      const { baseUrl, error } = await rpc.call("previewBase");
      if (baseUrl === null) throw new Error(error ?? "No preview URL available.");
      previewBaseRef.current = baseUrl;
      return attempt(baseUrl);
    },
    [rpc],
  );

  const loadIntoSlot = useCallback(
    async (index: number, entry: BrowseEntry) => {
      updateSlot(index, {
        path: entry.path,
        name: entry.name,
        loading: true,
        error: null,
        playing: false,
        duration: 0,
      });
      try {
        const player = await ensurePlayer();
        const encoded = await fetchSample(entry.path);
        await player.loadSlot(index, encoded);
        updateSlot(index, { loading: false, duration: player.durationOf(index) });
      } catch (error) {
        updateSlot(index, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [ensurePlayer, fetchSample, updateSlot],
  );

  const toggleSlot = useCallback(
    async (index: number) => {
      const slot = slots[index];
      if (!slot || slot.path === null || slot.loading) return;
      const player = await ensurePlayer();
      if (slot.playing) {
        player.stopSlot(index);
        updateSlot(index, { playing: false });
        return;
      }
      player.playSlot(
        index,
        { loop: slot.loop, gain: slot.gain },
        { onEnded: () => updateSlot(index, { playing: false }) },
      );
      updateSlot(index, { playing: true });
    },
    [ensurePlayer, slots, updateSlot],
  );

  function clearSlot(index: number) {
    playerRef.current?.clearSlot(index);
    setSlots((previous) =>
      previous.map((slot, i) => (i === index ? { ...EMPTY_SLOT } : slot)),
    );
  }

  function stopAll() {
    playerRef.current?.stopAll();
    setSlots((previous) => previous.map((slot) => ({ ...slot, playing: false })));
  }

  function changeMasterGain(value: number) {
    setMasterGain(value);
    playerRef.current?.setMasterGain(value);
  }

  function changeSlotGain(index: number, value: number) {
    updateSlot(index, { gain: value });
    playerRef.current?.setSlotGain(index, value);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-4 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2" aria-label="Output level">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">out</span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div
              aria-hidden="true"
              className="h-full rounded-full bg-primary transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          master
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterGain}
            onChange={(event) => changeMasterGain(Number(event.target.value))}
            className="w-28 accent-primary"
          />
        </label>
        <Button size="sm" variant="outline" onClick={stopAll}>
          Stop all
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 min-w-56 flex-col border-r border-border">
          <div className="border-b border-border p-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search samples…"
              aria-label="Search samples"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {browseError !== null && (
              <p className="p-3 text-xs text-destructive">{browseError}</p>
            )}
            {browseError === null && entries.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                {root === null ? "No sample folder set." : "No audio files found."}
              </p>
            )}
            {entries.map((entry) => (
              <div
                key={entry.path}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_MIME, entry.path);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="cursor-grab rounded px-2 py-1.5 text-sm hover:bg-accent active:cursor-grabbing"
                title={entry.path}
              >
                <div className="truncate">{entry.name}</div>
                {entry.folder !== "" && (
                  <div className="truncate text-xs text-muted-foreground">{entry.folder}</div>
                )}
              </div>
            ))}
            {truncated && (
              <p className="p-3 text-xs text-muted-foreground">
                Showing the first matches — narrow the search to see more.
              </p>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {slots.map((slot, index) => (
              <div
                key={index}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDragSlot(index);
                }}
                onDragLeave={() => setDragSlot((current) => (current === index ? null : current))}
                onDrop={(event) => {
                  const path = event.dataTransfer.getData(DRAG_MIME);
                  if (path === "") return;
                  event.preventDefault();
                  setDragSlot(null);
                  const entry = entries.find((candidate) => candidate.path === path);
                  if (entry) void loadIntoSlot(index, entry);
                }}
                className={cn(
                  "flex h-36 flex-col justify-between rounded-lg border border-border bg-card p-3 transition",
                  dragSlot === index && "border-primary bg-accent",
                  slot.playing && "border-primary",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      {index + 1}
                    </span>
                    {slot.path !== null && (
                      <button
                        type="button"
                        onClick={() => clearSlot(index)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        clear
                      </button>
                    )}
                  </div>
                  <div className="mt-1 truncate text-sm" title={slot.path ?? undefined}>
                    {slot.name ?? (
                      <span className="text-muted-foreground">Drop a sample</span>
                    )}
                  </div>
                  {slot.error !== null && (
                    <div className="mt-1 truncate text-xs text-destructive" title={slot.error}>
                      {slot.error}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={slot.playing ? "default" : "outline"}
                    disabled={slot.path === null || slot.loading}
                    onClick={() => void toggleSlot(index)}
                  >
                    {slot.loading ? "…" : slot.playing ? "Stop" : "Play"}
                  </Button>
                  <button
                    type="button"
                    aria-pressed={slot.loop}
                    onClick={() => updateSlot(index, { loop: !slot.loop })}
                    className={cn(
                      "rounded border border-border px-2 py-1 text-xs",
                      slot.loop ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    loop
                  </button>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {formatDuration(slot.duration)}
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={slot.gain}
                  aria-label={`Slot ${index + 1} gain`}
                  onChange={(event) => changeSlotGain(index, Number(event.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workstation",
    title: "Ambient Live",
    icon: "Zap",
    path: "workstation",
    component: Workstation,
  });
});
