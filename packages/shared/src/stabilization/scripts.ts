/**
 * JavaScript to inject for seeding Math.random() AND crypto.getRandomValues().
 * Uses a simple Linear Congruential Generator (LCG) for reproducible random values.
 *
 * crypto.getRandomValues() is overridden because libraries like nanoid (used by
 * Excalidraw for element IDs) use it instead of Math.random(). Non-deterministic
 * IDs can affect rendering order, React reconciliation, and canvas compositing.
 */
export function getFreezeRandomScript(seed: number, reseedOnInput?: boolean): string {
  return `
    (function() {
      var baseSeed = ${seed};
      // Separate LCG states so crypto calls (nanoid) don't shift Math.random sequence (rough.js seeds)
      var mathState = ${seed};
      var cryptoState = (${seed} * 2654435761 >>> 0) || 1;

      function nextMath() {
        mathState = (mathState * 1103515245 + 12345) & 0x7fffffff;
        return mathState;
      }
      function nextCrypto() {
        cryptoState = (cryptoState * 1103515245 + 12345) & 0x7fffffff;
        return cryptoState;
      }

      Math.random = function() {
        return nextMath() / 0x7fffffff;
      };
      // Override crypto.getRandomValues to produce deterministic bytes
      crypto.getRandomValues = function(array) {
        for (var i = 0; i < array.length; i++) {
          array[i] = nextCrypto() & (array instanceof Uint8Array ? 0xff :
                                      array instanceof Uint16Array ? 0xffff :
                                      0xffffffff);
        }
        return array;
      };
      // Override crypto.randomUUID for deterministic UUIDs
      if (crypto.randomUUID) {
        crypto.randomUUID = function() {
          var hex = '';
          for (var i = 0; i < 32; i++) {
            hex += (nextCrypto() & 0xf).toString(16);
          }
          return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-'+
                 ((nextCrypto() & 0x3 | 0x8).toString(16))+hex.slice(17,20)+'-'+hex.slice(20,32);
        };
      }
      window.__resetMathRandom = function() {
        mathState = ${seed};
      };
${reseedOnInput ? `
      // Reseed LCG on user input events so element creation gets a seed
      // determined by the triggering event, not async RNG drift.
      function __hashInputEvent(e) {
        var h = baseSeed;
        var t = e.type;
        for (var i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
        h = ((h << 5) - h + ((e.clientX || 0) | 0)) | 0;
        h = ((h << 5) - h + ((e.clientY || 0) | 0)) | 0;
        if (e.key) for (var j = 0; j < e.key.length; j++) h = ((h << 5) - h + e.key.charCodeAt(j)) | 0;
        return (h & 0x7fffffff) || 1;
      }
      ['pointerdown','pointerup','keydown','keyup'].forEach(function(evtType) {
        window.addEventListener(evtType, function(e) {
          if (!e.isTrusted) return;
          var h = __hashInputEvent(e);
          cryptoState = (h * 2654435761 >>> 0) || 1;
        }, true);
      });
` : ''}
    })();
  `;
}

/**
 * JavaScript to inject for freezing Date/Date.now() only.
 * Unlike page.clock.setFixedTime(), this does NOT install fake-timers,
 * so setTimeout/setInterval/requestAnimationFrame continue working normally.
 */
export function getFreezeTimestampsScript(frozenTimestamp: string): string {
  return `
    (function() {
      var frozenDate = new Date('${frozenTimestamp}');
      var frozenTime = frozenDate.getTime();
      var OriginalDate = Date;
      function FrozenDate() {
        if (arguments.length === 0) return new OriginalDate(frozenTime);
        return new (Function.prototype.bind.apply(OriginalDate, [null].concat(Array.prototype.slice.call(arguments))))();
      }
      FrozenDate.now = function() { return frozenTime; };
      FrozenDate.parse = OriginalDate.parse;
      FrozenDate.UTC = OriginalDate.UTC;
      FrozenDate.prototype = OriginalDate.prototype;
      window.Date = FrozenDate;
    })();
  `;
}
