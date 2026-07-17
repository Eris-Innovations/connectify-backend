export const MEDIA_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/3gpp': '.3gp',
  'audio/3gp': '.3gp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

export function isAllowedMediaMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MEDIA_EXTENSION_BY_MIME, mime);
}

export function folderForMime(mime: string): 'images' | 'videos' | 'audio' | 'documents' {
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'images';
  return 'documents';
}

export function extensionForMime(mime: string): string | undefined {
  return MEDIA_EXTENSION_BY_MIME[mime];
}
