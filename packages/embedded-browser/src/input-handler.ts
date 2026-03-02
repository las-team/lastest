/**
 * Input Handler
 *
 * Receives mouse/keyboard events from WebSocket clients and forwards
 * them to the browser via Chrome DevTools Protocol.
 */

import type { CDPSession, Page } from 'playwright';

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

export type InputEvent = MouseEvent | KeyboardEvent;

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
    if (!this.cdpSession) return;

    // Track modifier state for contextmenu dispatching
    if (event.modifiers) {
      this.modifiers.ctrl = event.modifiers.ctrl ?? false;
      this.modifiers.shift = event.modifiers.shift ?? false;
      this.modifiers.alt = event.modifiers.alt ?? false;
      this.modifiers.meta = event.modifiers.meta ?? false;
    }

    const modifiers = getModifierFlags(event.modifiers);

    switch (event.action) {
      case 'keydown':
        await this.cdpSession.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: event.key,
          code: event.code ?? '',
          text: event.text ?? '',
          modifiers,
        });
        break;

      case 'keyup':
        await this.cdpSession.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: event.key,
          code: event.code ?? '',
          modifiers,
        });
        break;

      case 'type':
        // Type each character individually
        if (event.text) {
          for (const char of event.text) {
            await this.cdpSession.send('Input.dispatchKeyEvent', {
              type: 'keyDown',
              key: char,
              text: char,
              modifiers,
            });
            await this.cdpSession.send('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: char,
              modifiers,
            });
          }
        }
        break;
    }
  }
}
