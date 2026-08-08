// bb-plugin-ambient-live — the workstation's backend.
//
// Two jobs: list the audio files under the user's sample root, and hand the
// panel a confined preview base URL it can fetch those bytes from. Everything
// goes through bb.sdk.files so a sample root on an enrolled remote host works
// exactly like a local one.
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

const AUDIO_EXTENSIONS = ["wav", "aif", "aiff", "flac", "mp3", "m4a", "ogg"];

const browseEntry = z.object({
  path: z.string(),
  name: z.string(),
  folder: z.string(),
});

export const rpcContract = defineRpcContract({
  browse: {
    input: z.object({ query: z.string() }).strict(),
    output: z.object({
      root: z.string().nullable(),
      entries: z.array(browseEntry),
      truncated: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  // A short-lived, path-shaped base URL confined to the sample root. The panel
  // appends encoded relative segments to fetch bytes; the URL never reveals the
  // host id or the absolute root.
  previewBase: {
    input: z.null(),
    output: z.object({
      baseUrl: z.string().nullable(),
      expiresAtMs: z.number().nullable(),
      error: z.string().nullable(),
    }),
  },
});

function isAudioPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

function folderOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash < 0 ? "" : relativePath.slice(0, slash);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    sampleRoot: {
      type: "string",
      label: "Sample folder",
      default: "",
    },
  });

  const initial = await settings.get();
  if (!initial.sampleRoot) {
    bb.status.needsConfiguration(
      "Set the sample folder with `bb plugin config ambient-live set sampleRoot <path>`.",
    );
  }

  // Re-read per call: settings edits do not reload a healthy plugin.
  async function sampleRoot(): Promise<string | null> {
    const { sampleRoot } = await settings.get();
    const trimmed = sampleRoot.trim();
    return trimmed === "" ? null : trimmed;
  }

  bb.rpc.register(rpcContract, {
    async browse({ query }) {
      const root = await sampleRoot();
      if (root === null) {
        return {
          root: null,
          entries: [],
          truncated: false,
          error: "No sample folder set yet.",
        };
      }

      try {
        const listing = await bb.sdk.files.listPaths({
          path: root,
          query: query.trim() === "" ? undefined : query,
          limit: 500,
          includeFiles: true,
          includeDirectories: false,
        });

        const entries = listing.paths
          .filter((entry) => isAudioPath(entry.path))
          .map((entry) => ({
            path: entry.path,
            name: entry.name,
            folder: folderOf(entry.path),
          }));

        return {
          root,
          entries,
          truncated: listing.truncated,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bb.log.warn(`browse failed: ${message}`);
        return { root, entries: [], truncated: false, error: message };
      }
    },

    async previewBase() {
      const root = await sampleRoot();
      if (root === null) {
        return {
          baseUrl: null,
          expiresAtMs: null,
          error: "No sample folder set yet.",
        };
      }

      try {
        const preview = await bb.sdk.files.createPreview({ rootPath: root });
        return {
          baseUrl: preview.baseUrl,
          expiresAtMs: preview.expiresAtMs,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bb.log.warn(`createPreview failed: ${message}`);
        return { baseUrl: null, expiresAtMs: null, error: message };
      }
    },
  });
}
