interface FileSystemHandle {
  readonly kind: 'file' | 'directory'
  readonly name: string
}
interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file'
  getFile(): Promise<File>
}
interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory'
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}
interface Window {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }) => Promise<FileSystemDirectoryHandle>
}
