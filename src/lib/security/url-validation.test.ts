import { describe, it, expect } from 'vitest';
import { validateUrl } from './url-validation';

describe('validateUrl — SSRF Protection', () => {
  describe('valid URLs (should return null)', () => {
    it('allows https://example.com', () => {
      expect(validateUrl('https://example.com')).toBeNull();
    });

    it('allows http://example.com', () => {
      expect(validateUrl('http://example.com')).toBeNull();
    });

    it('allows https with path and query', () => {
      expect(validateUrl('https://example.com/path?q=1')).toBeNull();
    });

    it('allows https with port', () => {
      expect(validateUrl('https://example.com:8080')).toBeNull();
    });

    it('allows public IP 8.8.8.8', () => {
      expect(validateUrl('http://8.8.8.8')).toBeNull();
    });

    it('allows public IP 203.0.113.1', () => {
      expect(validateUrl('https://203.0.113.1')).toBeNull();
    });
  });

  describe('protocol blocking', () => {
    it('blocks ftp:// protocol', () => {
      expect(validateUrl('ftp://example.com')).toBe('Only HTTP(S) protocols are allowed');
    });

    it('blocks file:// protocol', () => {
      expect(validateUrl('file:///etc/passwd')).toBe('Only HTTP(S) protocols are allowed');
    });

    it('blocks javascript: protocol', () => {
      expect(validateUrl('javascript:alert(1)')).toBe('Only HTTP(S) protocols are allowed');
    });

    it('blocks data: protocol', () => {
      expect(validateUrl('data:text/html,<h1>hi</h1>')).toBe('Only HTTP(S) protocols are allowed');
    });

    it('blocks gopher:// protocol', () => {
      expect(validateUrl('gopher://evil.com')).toBe('Only HTTP(S) protocols are allowed');
    });
  });

  describe('invalid URLs', () => {
    it('rejects empty string', () => {
      expect(validateUrl('')).toBe('Invalid URL');
    });

    it('rejects malformed URL', () => {
      expect(validateUrl('not-a-url')).toBe('Invalid URL');
    });
  });

  describe('RFC 1918 — private network ranges', () => {
    it('blocks 10.0.0.1 (10.0.0.0/8)', () => {
      expect(validateUrl('http://10.0.0.1')).toBe('URL targets a private network');
    });

    it('blocks 10.255.255.255 (10.0.0.0/8)', () => {
      expect(validateUrl('http://10.255.255.255')).toBe('URL targets a private network');
    });

    it('blocks 172.16.0.1 (172.16.0.0/12)', () => {
      expect(validateUrl('http://172.16.0.1')).toBe('URL targets a private network');
    });

    it('blocks 172.31.255.255 (172.16.0.0/12)', () => {
      expect(validateUrl('http://172.31.255.255')).toBe('URL targets a private network');
    });

    it('blocks 192.168.0.1 (192.168.0.0/16)', () => {
      expect(validateUrl('http://192.168.0.1')).toBe('URL targets a private network');
    });

    it('blocks 192.168.255.255 (192.168.0.0/16)', () => {
      expect(validateUrl('http://192.168.255.255')).toBe('URL targets a private network');
    });
  });

  describe('loopback', () => {
    it('blocks 127.0.0.1', () => {
      expect(validateUrl('http://127.0.0.1')).toBe('URL targets a private network');
    });

    it('blocks 127.0.0.2', () => {
      expect(validateUrl('http://127.0.0.2')).toBe('URL targets a private network');
    });

    it('blocks localhost', () => {
      expect(validateUrl('http://localhost')).toBe('URL targets a blocked hostname');
    });

    it('blocks localhost with port', () => {
      expect(validateUrl('http://localhost:3000')).toBe('URL targets a blocked hostname');
    });
  });

  describe('link-local', () => {
    it('blocks 169.254.0.1', () => {
      expect(validateUrl('http://169.254.0.1')).toBe('URL targets a private network');
    });

    it('blocks 169.254.169.254 (cloud metadata)', () => {
      expect(validateUrl('http://169.254.169.254')).toBe('URL targets a private network');
    });
  });

  describe('cloud metadata endpoints', () => {
    it('blocks metadata.google.internal', () => {
      expect(validateUrl('http://metadata.google.internal')).toBe('URL targets a blocked hostname');
    });

    it('blocks metadata.google.internal with path', () => {
      expect(validateUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe('URL targets a blocked hostname');
    });
  });

  describe('IPv6 private ranges', () => {
    it('blocks ::1 (IPv6 loopback)', () => {
      expect(validateUrl('http://[::1]')).toBe('URL targets a private network');
    });

    it('blocks fc00:: (unique local)', () => {
      expect(validateUrl('http://[fc00::1]')).toBe('URL targets a private network');
    });

    it('blocks fd00:: (unique local)', () => {
      expect(validateUrl('http://[fd12::1]')).toBe('URL targets a private network');
    });

    it('blocks fe80:: (link-local)', () => {
      expect(validateUrl('http://[fe80::1]')).toBe('URL targets a private network');
    });
  });

  describe('0.0.0.0 range', () => {
    it('blocks 0.0.0.0', () => {
      expect(validateUrl('http://0.0.0.0')).toBe('URL targets a private network');
    });
  });
});
