import { contextBridge, ipcRenderer } from 'electron'
import type { DrawingDoc, NibIndex, NoteDoc } from '../shared/types'

/**
 * The whole surface the renderer gets. Everything that touches disk happens in
 * the main process; this is the only way across, and it is a fixed list of
 * calls rather than a general "invoke anything" hole.
 */
const api = {
  info: (): Promise<{ version: string; dataDir: string }> => ipcRenderer.invoke('app:info'),

  loadIndex: (): Promise<NibIndex> => ipcRenderer.invoke('index:load'),
  saveIndex: (index: NibIndex): Promise<void> => ipcRenderer.invoke('index:save', index),

  readNote: (id: string): Promise<NoteDoc | null> => ipcRenderer.invoke('note:read', id),
  /** Returns the `edited` timestamp the main process stamped on the file. */
  writeNote: (doc: NoteDoc): Promise<number> => ipcRenderer.invoke('note:write', doc),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('note:delete', id),

  readDrawing: (id: string): Promise<DrawingDoc | null> => ipcRenderer.invoke('drawing:read', id),
  writeDrawing: (doc: DrawingDoc): Promise<void> => ipcRenderer.invoke('drawing:write', doc),
  deleteDrawing: (id: string): Promise<void> => ipcRenderer.invoke('drawing:delete', id),

  /** Store a pasted image and get back the URL to reference it by. */
  writeAsset: (dataUrl: string): Promise<string> => ipcRenderer.invoke('asset:write', dataUrl),

  openSticky: (noteId: string): Promise<void> => ipcRenderer.invoke('sticky:open', noteId),
  closeSticky: (noteId: string): Promise<void> => ipcRenderer.invoke('sticky:close', noteId),

  /** Put text on the system clipboard - see the handler for why not the renderer. */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),

  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  /** Returns the new always-on-top state. */
  toggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-always-on-top'),

  /**
   * Fires when a sticky window is closed, so its note can stop being pinned.
   * Returns its own unsubscribe.
   */
  onStickyClosed: (handler: (noteId: string) => void): (() => void) => {
    const listener = (_event: unknown, noteId: string): void => handler(noteId)
    ipcRenderer.on('sticky:closed', listener)
    return () => {
      ipcRenderer.removeListener('sticky:closed', listener)
    }
  },

  /**
   * Fires when the data on disk changed - another window of ours, or an external
   * writer such as Dropbox syncing the folder down. Returns its own unsubscribe.
   */
  /*
   * Recording a meeting to disk.
   *
   * `sendChunk` is fire-and-forget: it runs every few hundred milliseconds for
   * the length of a meeting, and waiting for an answer that carries no
   * information would put an IPC round trip in the capture path.
   */
  startRecording: (noteId: string): Promise<string> =>
    ipcRenderer.invoke('recording:start', noteId),
  sendChunk: (chunk: Uint8Array): void => ipcRenderer.send('recording:chunk', chunk),
  stopRecording: (): Promise<{ path: string; seconds: number; bytes: number } | null> =>
    ipcRenderer.invoke('recording:stop'),
  deleteRecording: (path: string): Promise<void> =>
    ipcRenderer.invoke('recording:delete', path),

  /**
   * Summarise a meeting. The only call in this app that leaves the machine, and
   * the only one that spends anything.
   */
  summarise: (request: {
    kind?: 'meeting' | 'note'
    transcript: string
    notes: string
    previous?: string
    language: 'sv' | 'en'
    model: string
  }): Promise<{
    ok: boolean
    reason?: string
    model?: string
    costUsd?: number | null
    value?: {
      summary: string
      decisions: string[]
      actions: { text: string; implied: boolean }[]
      questions: string[]
      people: string[]
      lastTime?: string
    }
  }> => ipcRenderer.invoke('summary:run', request),

  /** Whether transcription can run for a language, and if not, why not. */
  transcribeStatus: (
    language: 'sv' | 'en'
  ): Promise<{ ready: boolean; why?: string; root: string }> =>
    ipcRenderer.invoke('transcribe:status', language),

  transcribe: (args: {
    path: string
    language: 'sv' | 'en'
    seconds: number
  }): Promise<{ segments: { start: string; end: string; text: string }[]; text: string }> =>
    ipcRenderer.invoke('transcribe:run', args),

  /** How far along it is, pushed as whisper works through the file. */
  onTranscribeProgress: (handler: (fraction: number) => void): (() => void) => {
    const listener = (_event: unknown, fraction: number): void => handler(fraction)
    ipcRenderer.on('transcribe:progress', listener)
    return () => {
      ipcRenderer.removeListener('transcribe:progress', listener)
    }
  },

  onIndexChanged: (handler: () => void): (() => void) => {
    const listener = (): void => handler()
    ipcRenderer.on('index:changed', listener)
    return () => {
      ipcRenderer.removeListener('index:changed', listener)
    }
  }
}

export type NibApi = typeof api

contextBridge.exposeInMainWorld('nib', api)
