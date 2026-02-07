/**
 * OneBunFile - Unified file wrapper for file uploads
 *
 * Provides a consistent interface for files uploaded via:
 * - multipart/form-data (standard file upload)
 * - JSON body with base64-encoded data
 *
 * @example
 * ```typescript
 * // Access file metadata
 * console.log(file.name);  // "photo.png"
 * console.log(file.size);  // 1024
 * console.log(file.type);  // "image/png"
 *
 * // Convert to base64
 * const base64 = await file.toBase64();
 *
 * // Write to disk
 * await file.writeTo('./uploads/photo.png');
 *
 * // Get as Buffer
 * const buffer = await file.toBuffer();
 * ```
 */
export class OneBunFile {
  /** File name (e.g., "photo.png") */
  readonly name: string;
  /** File size in bytes */
  readonly size: number;
  /** MIME type (e.g., "image/png") */
  readonly type: string;
  /** Last modified timestamp */
  readonly lastModified: number;

  private readonly _blob: Blob;
  private _base64Cache?: string;

  /**
   * Create from a Web API File (typically from multipart/form-data)
   */
  constructor(file: File) {
    this.name = file.name;
    this.size = file.size;
    this.type = file.type;
    this.lastModified = file.lastModified;
    this._blob = file;
  }

  /**
   * Create OneBunFile from a base64-encoded string
   *
   * @param data - Base64-encoded file data (with or without data URI prefix)
   * @param filename - File name (default: "upload")
   * @param mimeType - MIME type (default: "application/octet-stream")
   * @returns OneBunFile instance
   *
   * @example
   * ```typescript
   * // From raw base64
   * const file = OneBunFile.fromBase64('iVBORw0KGgo...', 'photo.png', 'image/png');
   *
   * // From data URI
   * const file = OneBunFile.fromBase64('data:image/png;base64,iVBORw0KGgo...', 'photo.png');
   * ```
   */
  static fromBase64(
    data: string,
    filename: string = 'upload',
    mimeType: string = MimeType.OCTET_STREAM,
  ): OneBunFile {
    // Handle data URI format: "data:image/png;base64,iVBORw0KGgo..."
    let base64Data = data;
    let detectedMimeType = mimeType;

    const dataUriMatch = data.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedMimeType = dataUriMatch[1];
      base64Data = dataUriMatch[2];
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const file = new File([bytes], filename, {
      type: detectedMimeType,
      lastModified: Date.now(),
    });

    const oneBunFile = new OneBunFile(file);
    // Cache the base64 since we already have it
    oneBunFile._base64Cache = base64Data;

    return oneBunFile;
  }

  /**
   * Convert file content to a base64-encoded string.
   * Result is cached after the first call.
   *
   * @returns Base64-encoded string (without data URI prefix)
   */
  async toBase64(): Promise<string> {
    if (this._base64Cache) {
      return this._base64Cache;
    }

    const arrayBuffer = await this._blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    this._base64Cache = btoa(binary);

    return this._base64Cache;
  }

  /**
   * Convert file content to a Buffer
   */
  async toBuffer(): Promise<Buffer> {
    const arrayBuffer = await this._blob.arrayBuffer();

    return Buffer.from(arrayBuffer);
  }

  /**
   * Convert file content to an ArrayBuffer
   */
  async toArrayBuffer(): Promise<ArrayBuffer> {
    return await this._blob.arrayBuffer();
  }

  /**
   * Get the underlying Blob
   */
  toBlob(): Blob {
    return this._blob;
  }

  /**
   * Write file to disk using Bun.write()
   *
   * @param path - Destination file path
   *
   * @example
   * ```typescript
   * await file.writeTo('./uploads/photo.png');
   * await file.writeTo(`./uploads/${file.name}`);
   * ```
   */
  async writeTo(path: string): Promise<void> {
    await Bun.write(path, this._blob);
  }
}

// =============================================================================
// MimeType Enum
// =============================================================================

/**
 * Common MIME types for use with file upload decorators.
 * Includes wildcard groups for matching entire categories.
 *
 * @example
 * ```typescript
 * // Accept only images
 * \@UploadedFile('avatar', { mimeTypes: [MimeType.ANY_IMAGE] })
 *
 * // Accept specific types
 * \@UploadedFile('avatar', { mimeTypes: [MimeType.PNG, MimeType.JPEG, MimeType.WEBP] })
 *
 * // Mix enum values and string literals
 * \@UploadedFile('doc', { mimeTypes: [MimeType.PDF, 'application/msword'] })
 * ```
 */
export enum MimeType {
  // Wildcard groups
  ANY = '*/*',
  ANY_IMAGE = 'image/*',
  ANY_VIDEO = 'video/*',
  ANY_AUDIO = 'audio/*',
  ANY_TEXT = 'text/*',
  ANY_APPLICATION = 'application/*',

  // Images
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  GIF = 'image/gif',
  WEBP = 'image/webp',
  SVG = 'image/svg+xml',
  ICO = 'image/x-icon',
  BMP = 'image/bmp',
  AVIF = 'image/avif',

  // Documents
  PDF = 'application/pdf',
   
  JSON = 'application/json',
  XML = 'application/xml',
  ZIP = 'application/zip',
  GZIP = 'application/gzip',
  CSV = 'text/csv',
  XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  // Video
  MP4 = 'video/mp4',
  WEBM = 'video/webm',

  // Audio
  MP3 = 'audio/mpeg',
  WAV = 'audio/wav',
  OGG = 'audio/ogg',

  // Text
  PLAIN = 'text/plain',
  HTML = 'text/html',
  CSS = 'text/css',
  JAVASCRIPT = 'text/javascript',

  // Binary
  OCTET_STREAM = 'application/octet-stream',
}

// =============================================================================
// File Validation Helpers
// =============================================================================

/**
 * Check if a MIME type matches a pattern (supports wildcards).
 *
 * @param actual - The actual MIME type of the file (e.g., "image/png")
 * @param pattern - The pattern to match against (e.g., "image/*", "image/png", "*\/*")
 * @returns true if the actual MIME type matches the pattern
 *
 * @example
 * ```typescript
 * matchMimeType('image/png', 'image/*')    // true
 * matchMimeType('image/png', 'image/png')  // true
 * matchMimeType('image/png', 'video/*')    // false
 * matchMimeType('image/png', '*\/*')       // true
 * ```
 */
export function matchMimeType(actual: string, pattern: string): boolean {
  if (pattern === '*/*') {
    return true;
  }

  const [patternType, patternSubtype] = pattern.split('/');
  const [actualType, actualSubtype] = actual.split('/');

  if (patternSubtype === '*') {
    return patternType === actualType;
  }

  return patternType === actualType && patternSubtype === actualSubtype;
}

/**
 * Options for file validation
 */
export interface FileValidationOptions {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types (supports wildcards like 'image/*') */
  mimeTypes?: string[];
}

/**
 * Validate a file against size and MIME type constraints.
 * Throws an Error with a descriptive message if validation fails.
 *
 * @param file - The OneBunFile to validate
 * @param options - Validation options
 * @param fieldName - Field name for error messages
 */
export function validateFile(
  file: OneBunFile,
  options: FileValidationOptions,
  fieldName?: string,
): void {
  const prefix = fieldName ? `File "${fieldName}"` : 'File';

  // Validate file size
  if (options.maxSize !== undefined && file.size > options.maxSize) {
    throw new Error(
      `${prefix} exceeds maximum size. Got ${file.size} bytes, max is ${options.maxSize} bytes`,
    );
  }

  // Validate MIME type
  if (options.mimeTypes && options.mimeTypes.length > 0) {
    const matches = options.mimeTypes.some((pattern) => matchMimeType(file.type, pattern));
    if (!matches) {
      throw new Error(
        `${prefix} has invalid MIME type "${file.type}". Allowed: ${options.mimeTypes.join(', ')}`,
      );
    }
  }
}
