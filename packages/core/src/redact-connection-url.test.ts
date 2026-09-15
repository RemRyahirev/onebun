import {
  describe,
  expect,
  it,
} from 'bun:test';

import { redactConnectionUrl } from './redact-connection-url';

describe('redactConnectionUrl', () => {
  it('should replace the password and leave scheme, user, host, port, path and query intact', () => {
    expect(redactConnectionUrl('postgresql://app:hunter2@127.0.0.1:5997/orders'))
      .toBe('postgresql://app:***@127.0.0.1:5997/orders');

    // The query string is the reason `?sslmode=require` reaches the driver at all: it must
    // survive the redaction byte for byte.
    expect(redactConnectionUrl('postgresql://app:hunter2@db:5432/orders?sslmode=require'))
      .toBe('postgresql://app:***@db:5432/orders?sslmode=require');
  });

  describe('the passwords the previous implementations leaked', () => {
    // Both of these are ordinary provider-generated passwords. The regex this replaced classed
    // the password as `[^@/]*`, so a `/` made it match NOTHING — the URL came back untouched,
    // credential included — and an `@` ended the match at the first one. `new URL()`, the other
    // implementation, throws outright on the `/` case and its `catch` printed the input as given.
    it('should redact a password containing a forward slash', () => {
      const redacted = redactConnectionUrl('postgresql://app:pa/ss@db:5432/orders');

      expect(redacted).toBe('postgresql://app:***@db:5432/orders');
      expect(redacted).not.toContain('pa/ss');
    });

    it('should redact a password containing an at sign, all the way to the real separator', () => {
      const redacted = redactConnectionUrl('postgresql://app:pa@ss@db:5432/orders');

      expect(redacted).toBe('postgresql://app:***@db:5432/orders');
      expect(redacted).not.toContain('pa@ss');
      // The failure mode being pinned: stopping at the FIRST `@` leaves `ss` in the host slot.
      expect(redacted).not.toContain('ss@db');
    });

    it('should redact a password mixing at, slash, percent and colon', () => {
      const redacted = redactConnectionUrl('postgresql://app:p@ss/w%x:y@db:5432/orders?sslmode=require');

      expect(redacted).toBe('postgresql://app:***@db:5432/orders?sslmode=require');
      expect(redacted).not.toContain('p@ss');
      expect(redacted).not.toContain('w%x');
    });

    it('should still redact when a raw question mark inside the password hides the separator', () => {
      // `?` bounds the search for the userinfo, so a raw one inside the password pushes the real
      // `@` out of range. The fallback over-redacts rather than emitting the credential: the host
      // becomes illegible, which is the recoverable half of the trade.
      const redacted = redactConnectionUrl('postgresql://app:pa?ss@db:5432/orders');

      expect(redacted).not.toContain('pa?ss');
      expect(redacted).toContain('***');
    });
  });

  it('should leave a URL that carries no password alone', () => {
    expect(redactConnectionUrl('redis://127.0.0.1:6379/0')).toBe('redis://127.0.0.1:6379/0');
    // A username with no password: inventing `:***` would claim a credential that is not there.
    expect(redactConnectionUrl('postgresql://app@db:5432/orders')).toBe('postgresql://app@db:5432/orders');
  });

  it('should redact a passwordless userinfo of the `redis://:secret@host` shape', () => {
    expect(redactConnectionUrl('redis://:s3cr3t@cache:6379/1')).toBe('redis://:***@cache:6379/1');
  });

  it('should redact a secret carried in the query string', () => {
    expect(redactConnectionUrl('postgresql://db:5432/orders?password=hunter2&sslmode=require'))
      .toBe('postgresql://db:5432/orders?password=***&sslmode=require');
    expect(redactConnectionUrl('postgresql://db:5432/orders?pwd=hunter2'))
      .toBe('postgresql://db:5432/orders?pwd=***');
  });

  it('should replace a string that is not a connection URL rather than echo it back', () => {
    // No `://` means no host worth preserving and no way to locate the userinfo. Echoing the
    // input is what leaked; saying nothing about it is the only safe answer.
    expect(redactConnectionUrl('app:hunter2@db:5432/orders')).toBe('<unparsable connection target>');
    expect(redactConnectionUrl('')).toBe('<unparsable connection target>');
  });

  it('should never emit the password for any of the characters a provider may generate', () => {
    const PASSWORD_CHARACTERS = ['@', '/', '%', ':', '&', '=', '+', '#', '?'];

    for (const character of PASSWORD_CHARACTERS) {
      const password = `pre${character}post`;
      const redacted = redactConnectionUrl(`postgresql://app:${password}@db:5432/orders`);

      expect(redacted).not.toContain(password);
      expect(redacted).toContain('***');
    }
  });
});
