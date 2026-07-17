import { describe, expect, it } from 'vitest';
import {
  extensionForMime,
  folderForMime,
  isAllowedMediaMime,
} from '../src/modules/media/media-mime';

describe('media MIME allow-list', () => {
  it('allows images, video, audio, and common documents', () => {
    expect(isAllowedMediaMime('image/jpeg')).toBe(true);
    expect(isAllowedMediaMime('video/mp4')).toBe(true);
    expect(isAllowedMediaMime('audio/mp4')).toBe(true);
    expect(isAllowedMediaMime('application/pdf')).toBe(true);
    expect(
      isAllowedMediaMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe(true);
    expect(isAllowedMediaMime('text/plain')).toBe(true);
    expect(isAllowedMediaMime('application/zip')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isAllowedMediaMime('application/octet-stream')).toBe(false);
    expect(isAllowedMediaMime('application/x-msdownload')).toBe(false);
  });

  it('maps folders and extensions', () => {
    expect(folderForMime('image/png')).toBe('images');
    expect(folderForMime('video/quicktime')).toBe('videos');
    expect(folderForMime('audio/aac')).toBe('audio');
    expect(folderForMime('application/pdf')).toBe('documents');
    expect(extensionForMime('application/pdf')).toBe('.pdf');
  });
});
