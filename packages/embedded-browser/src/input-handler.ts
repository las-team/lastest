/**
 * Input Handler
 *
 * Receives mouse/keyboard events from WebSocket clients and forwards
 * them to the browser via Chrome DevTools Protocol.
 */

import type { CDPSession, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MouseEvent {
  type: 'mouse';
  action: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface KeyboardEvent {
  type: 'keyboard';
  action: 'keydown' | 'keyup' | 'type';
  key: string;
  code?: string;
  text?: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
}

export interface FileUploadEvent {
  type: 'file_upload';
  files: Array<{ name: string; data: string; mimeType: string }>; // base64 data
}

export interface ClipboardPasteEvent {
  type: 'clipboard_paste';
  text: string;
}

export type InputEvent = MouseEvent | KeyboardEvent | FileUploadEvent | ClipboardPasteEvent;

const BUTTON_MAP: Record<string, 'left' | 'right' | 'middle'> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
};

function getModifierFlags(modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): number {
  if (!modifiers) return 0;
  let flags = 0;
  if (modifiers.alt) flags |= 1;
  if (modifiers.ctrl) flags |= 2;
  if (modifiers.meta) flags |= 4;
  if (modifiers.shift) flags |= 8;
  return flags;
}

const KEY_TO_VK: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
  Escape: 27, Space: 32, ' ': 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46,
  Meta: 91,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
  NumLock: 144, ScrollLock: 145,
  CapsLock: 20, ContextMenu: 93, PrintScreen: 44, Pause: 19,
};

function getVirtualKeyCode(key: string): number {
  if (KEY_TO_VK[key] !== undefined) return KEY_TO_VK[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

export class InputHandler {
  private cdpSession: CDPSession | null = null;
  private page: Page | null = null;
  private modifiers = { ctrl: false, shift: false, alt: false, meta: false };

  async attach(page: Page): Promise<void> {
    this.page = page;
    this.cdpSession = await page.context().newCDPSession(page);
    this.modifiers = { ctrl: false, shift: false, alt: false, meta: false };
    console.log('[InputHandler] Attached to page');
  }

  async detach(): Promise<void> {
    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch {
        // Ignore
      }
      this.cdpSession = null;
    }
    this.page = null;
    this.modifiers = { ctrl: false, shift: false, alt: false, meta: false };
  }

  async handleInput(event: InputEvent): Promise<void> {
    if (!this.cdpSession) return;

    try {
      if (event.type === 'mouse') {
        await this.handleMouse(event);
      } else if (event.type === 'keyboard') {
        await this.handleKeyboard(event);
      } else if (event.type === 'file_upload') {
        await this.handleFileUpload(event);
      } else if (event.type === 'clipboard_paste') {
        await this.handleClipboardPaste(event);
      }
    } catch (error) {
      console.error('[InputHandler] Error dispatching event:', error);
    }
  }

  private async handleMouse(event: MouseEvent): Promise<void> {
    if (!this.cdpSession) return;

    const button = BUTTON_MAP[event.button ?? 'left'] ?? 'left';

    switch (event.action) {
      case 'move':
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: event.x,
          y: event.y,
        });
        break;

      case 'down':
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: event.x,
          y: event.y,
          button,
          clickCount: event.clickCount ?? 1,
        });
        break;

      case 'up':
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: event.x,
          y: event.y,
          button,
          clickCount: event.clickCount ?? 1,
        });
        // Dispatch synthetic contextmenu for right-click so browser-script sees it
        if (button === 'right' && this.page) {
          await this.page.evaluate(({ x, y, shiftKey }) => {
            const el = document.elementFromPoint(x, y) || document.body;
            el.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true, cancelable: true,
              clientX: x, clientY: y,
              shiftKey,
            }));
          }, { x: event.x, y: event.y, shiftKey: this.modifiers.shift });
        }
        break;

      case 'wheel':
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: event.x,
          y: event.y,
          deltaX: event.deltaX ?? 0,
          deltaY: event.deltaY ?? 0,
        });
        break;
    }
  }

  private async handleKeyboard(event: KeyboardEvent): Promise<void> {
    if (!this.page) return;

    // Track modifier state for contextmenu dispatching
    if (event.modifiers) {
      this.modifiers.ctrl = event.modifiers.ctrl ?? false;
      this.modifiers.shift = event.modifiers.shift ?? false;
      this.modifiers.alt = event.modifiers.alt ?? false;
      this.modifiers.meta = event.modifiers.meta ?? false;
    }

    switch (event.action) {
      case 'keydown': {
        const isChar = event.text && event.text.length === 1;
        if (isChar) {
          // Printable character: use press() which handles keyDown + char + keyUp
          // Build modifier prefix for Playwright's key descriptor format
          const modPrefix = this.buildModifierPrefix(event.modifiers);
          await this.page.keyboard.press(`${modPrefix}${event.key}`);
        } else {
          // Non-printable key (Backspace, Delete, Enter, arrows, etc.)
          await this.page.keyboard.down(event.key);
        }
        break;
      }

      case 'keyup': {
        await this.page.keyboard.up(event.key);
        break;
      }

      case 'type':
        if (event.text) {
          await this.page.keyboard.type(event.text);
        }
        break;
    }
  }

  private buildModifierPrefix(modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): string {
    if (!modifiers) return '';
    const parts: string[] = [];
    if (modifiers.ctrl) parts.push('Control+');
    if (modifiers.shift) parts.push('Shift+');
    if (modifiers.alt) parts.push('Alt+');
    if (modifiers.meta) parts.push('Meta+');
    return parts.join('');
  }

  private async handleFileUpload(event: FileUploadEvent): Promise<void> {
    if (!this.page) return;

    const tmpDir = path.join(os.tmpdir(), `lastest-stream-upload-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePaths: string[] = [];

    for (const file of event.files) {
      const safeName = path.basename(file.name).replace(/\.\./g, '_');
      const filePath = path.join(tmpDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
      filePaths.push(filePath);
    }

    try {
      await this.page.locator('input[type="file"]').setInputFiles(filePaths);
    } catch {
      // If no file input visible, the filechooser event handler should pick it up
      console.warn('[InputHandler] No file input found for upload, files written to:', tmpDir);
    }

    // Clean up temp files after a delay
    setTimeout(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }, 30000);
  }

  private async handleClipboardPaste(event: ClipboardPasteEvent): Promise<void> {
    if (!this.page) return;

    // Write text to the page's clipboard, then simulate Ctrl+V
    await this.page.evaluate((text) => navigator.clipboard.writeText(text), event.text);
    await this.page.keyboard.press('Control+V');
  }
}
