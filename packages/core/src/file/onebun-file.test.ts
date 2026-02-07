import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  OneBunFile,
  MimeType,
  matchMimeType,
  validateFile,
} from './onebun-file';

// =============================================================================
// OneBunFile Class Tests
// =============================================================================

describe('OneBunFile', () => {
  describe('constructor', () => {
    it('should create from File object', () => {
      const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      expect(oneBunFile.name).toBe('test.txt');
      expect(oneBunFile.size).toBe(11);
      expect(oneBunFile.type).toStartWith('text/plain');
      expect(oneBunFile.lastModified).toBeGreaterThan(0);
    });

    it('should preserve file metadata', () => {
      const file = new File(['data'], 'image.png', {
        type: 'image/png',
        lastModified: 1700000000000,
      });
      const oneBunFile = new OneBunFile(file);

      expect(oneBunFile.name).toBe('image.png');
      expect(oneBunFile.type).toBe('image/png');
      expect(oneBunFile.lastModified).toBe(1700000000000);
    });
  });

  describe('fromBase64', () => {
    it('should create from raw base64 string', () => {
      const base64 = btoa('hello world');
      const file = OneBunFile.fromBase64(base64, 'test.txt', 'text/plain');

      expect(file.name).toBe('test.txt');
      expect(file.size).toBe(11);
      expect(file.type).toStartWith('text/plain');
    });

    it('should create with default name and mime type', () => {
      const base64 = btoa('data');
      const file = OneBunFile.fromBase64(base64);

      expect(file.name).toBe('upload');
      expect(file.type).toBe('application/octet-stream');
    });

    it('should handle data URI format', () => {
      const base64 = btoa('png-data');
      const dataUri = `data:image/png;base64,${base64}`;
      const file = OneBunFile.fromBase64(dataUri, 'photo.png');

      expect(file.type).toBe('image/png');
      expect(file.name).toBe('photo.png');
    });

    it('should detect mime type from data URI even when explicit type is given', () => {
      const base64 = btoa('svg-data');
      const dataUri = `data:image/svg+xml;base64,${base64}`;
      // Data URI mime type should override the explicit one
      const file = OneBunFile.fromBase64(dataUri, 'image.svg', 'text/plain');

      expect(file.type).toBe('image/svg+xml');
    });
  });

  describe('toBase64', () => {
    it('should convert file to base64', async () => {
      const content = 'hello world';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      const base64 = await oneBunFile.toBase64();
      expect(base64).toBe(btoa(content));
    });

    it('should cache base64 result', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      const first = await oneBunFile.toBase64();
      const second = await oneBunFile.toBase64();
      expect(first).toBe(second);
    });

    it('should return cached base64 for fromBase64 files', async () => {
      const original = btoa('cached data');
      const file = OneBunFile.fromBase64(original, 'test.txt');

      const result = await file.toBase64();
      expect(result).toBe(original);
    });
  });

  describe('toBuffer', () => {
    it('should convert file to Buffer', async () => {
      const content = 'buffer test';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      const buffer = await oneBunFile.toBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe(content);
    });
  });

  describe('toArrayBuffer', () => {
    it('should convert file to ArrayBuffer', async () => {
      const content = 'arraybuffer test';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      const ab = await oneBunFile.toArrayBuffer();
      expect(ab).toBeInstanceOf(ArrayBuffer);
      expect(ab.byteLength).toBe(content.length);
    });
  });

  describe('toBlob', () => {
    it('should return underlying Blob', () => {
      const file = new File(['blob test'], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      const blob = oneBunFile.toBlob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBe(9);
    });
  });
});

// =============================================================================
// MimeType Enum Tests
// =============================================================================

describe('MimeType', () => {
  it('should have wildcard values', () => {
    expect(String(MimeType.ANY)).toBe('*/*');
    expect(String(MimeType.ANY_IMAGE)).toBe('image/*');
    expect(String(MimeType.ANY_VIDEO)).toBe('video/*');
    expect(String(MimeType.ANY_AUDIO)).toBe('audio/*');
    expect(String(MimeType.ANY_TEXT)).toBe('text/*');
    expect(String(MimeType.ANY_APPLICATION)).toBe('application/*');
  });

  it('should have image types', () => {
    expect(String(MimeType.PNG)).toBe('image/png');
    expect(String(MimeType.JPEG)).toBe('image/jpeg');
    expect(String(MimeType.GIF)).toBe('image/gif');
    expect(String(MimeType.WEBP)).toBe('image/webp');
    expect(String(MimeType.SVG)).toBe('image/svg+xml');
    expect(String(MimeType.AVIF)).toBe('image/avif');
  });

  it('should have document types', () => {
    expect(String(MimeType.PDF)).toBe('application/pdf');
    expect(String(MimeType.JSON)).toBe('application/json');
    expect(String(MimeType.CSV)).toBe('text/csv');
    expect(String(MimeType.ZIP)).toBe('application/zip');
  });

  it('should have media types', () => {
    expect(String(MimeType.MP4)).toBe('video/mp4');
    expect(String(MimeType.MP3)).toBe('audio/mpeg');
    expect(String(MimeType.WAV)).toBe('audio/wav');
  });

  it('should have text types', () => {
    expect(String(MimeType.PLAIN)).toBe('text/plain');
    expect(String(MimeType.HTML)).toBe('text/html');
    expect(String(MimeType.CSS)).toBe('text/css');
  });

  it('should have binary type', () => {
    expect(String(MimeType.OCTET_STREAM)).toBe('application/octet-stream');
  });
});

// =============================================================================
// matchMimeType Tests
// =============================================================================

describe('matchMimeType', () => {
  it('should match exact MIME types', () => {
    expect(matchMimeType('image/png', 'image/png')).toBe(true);
    expect(matchMimeType('text/plain', 'text/plain')).toBe(true);
    expect(matchMimeType('application/pdf', 'application/pdf')).toBe(true);
  });

  it('should not match different MIME types', () => {
    expect(matchMimeType('image/png', 'image/jpeg')).toBe(false);
    expect(matchMimeType('text/plain', 'text/html')).toBe(false);
    expect(matchMimeType('image/png', 'video/mp4')).toBe(false);
  });

  it('should match wildcard subtypes', () => {
    expect(matchMimeType('image/png', 'image/*')).toBe(true);
    expect(matchMimeType('image/jpeg', 'image/*')).toBe(true);
    expect(matchMimeType('image/webp', 'image/*')).toBe(true);
    expect(matchMimeType('video/mp4', 'video/*')).toBe(true);
    expect(matchMimeType('audio/mpeg', 'audio/*')).toBe(true);
  });

  it('should not match wrong type with wildcard', () => {
    expect(matchMimeType('video/mp4', 'image/*')).toBe(false);
    expect(matchMimeType('text/plain', 'image/*')).toBe(false);
  });

  it('should match universal wildcard', () => {
    expect(matchMimeType('image/png', '*/*')).toBe(true);
    expect(matchMimeType('video/mp4', '*/*')).toBe(true);
    expect(matchMimeType('application/json', '*/*')).toBe(true);
  });

  it('should work with MimeType enum values', () => {
    expect(matchMimeType('image/png', MimeType.ANY_IMAGE)).toBe(true);
    expect(matchMimeType('image/png', MimeType.PNG)).toBe(true);
    expect(matchMimeType('image/png', MimeType.JPEG)).toBe(false);
    expect(matchMimeType('application/pdf', MimeType.ANY_APPLICATION)).toBe(true);
  });
});

// =============================================================================
// validateFile Tests
// =============================================================================

describe('validateFile', () => {
  it('should pass validation when no constraints', () => {
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, {})).not.toThrow();
  });

  it('should pass when file is within size limit', () => {
    const file = new File(['small'], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, { maxSize: 1024 })).not.toThrow();
  });

  it('should throw when file exceeds size limit', () => {
    const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, { maxSize: 10 })).toThrow(
      /exceeds maximum size/,
    );
  });

  it('should include field name in size error', () => {
    const file = new File(['x'.repeat(100)], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, { maxSize: 10 }, 'avatar')).toThrow(
      /File "avatar" exceeds maximum size/,
    );
  });

  it('should pass when MIME type matches', () => {
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, { mimeTypes: ['image/*'] })).not.toThrow();
  });

  it('should pass when MIME type matches one of multiple', () => {
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    const oneBunFile = new OneBunFile(file);

    expect(() =>
      validateFile(oneBunFile, { mimeTypes: ['application/pdf', 'image/png'] }),
    ).not.toThrow();
  });

  it('should throw when MIME type does not match', () => {
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() => validateFile(oneBunFile, { mimeTypes: ['image/*'] })).toThrow(
      /invalid MIME type/,
    );
  });

  it('should include field name in MIME error', () => {
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    expect(() =>
      validateFile(oneBunFile, { mimeTypes: ['image/*'] }, 'document'),
    ).toThrow(/File "document" has invalid MIME type/);
  });

  it('should validate both size and MIME type', () => {
    const file = new File(['x'.repeat(100)], 'big.txt', { type: 'text/plain' });
    const oneBunFile = new OneBunFile(file);

    // Fails on size first
    expect(() =>
      validateFile(oneBunFile, { maxSize: 10, mimeTypes: ['image/*'] }),
    ).toThrow(/exceeds maximum size/);
  });
});
