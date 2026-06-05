(function () {
  // Document-level delegation — survives React re-renders / hydration
  // mismatches that would otherwise replace .share-slider DOM nodes after
  // this `defer` script has bound listeners to the originals.
  var activeFig = null;
  var activeStage = null;

  function deactivate() {
    if (!activeFig) return;
    if (activeFig.getAttribute('data-has-diff') === 'true') {
      activeFig.setAttribute('data-active', 'false');
    }
    activeFig = null;
    activeStage = null;
  }

  function setPct(fig, stage, clientX) {
    var rect = stage.getBoundingClientRect();
    if (!rect.width) return;
    var x = clientX - rect.left;
    var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    fig.style.setProperty('--pct', pct.toFixed(2) + '%');
    stage.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function activate(fig, stage, clientX) {
    if (activeFig && activeFig !== fig) deactivate();
    activeFig = fig;
    activeStage = stage;
    fig.setAttribute('data-active', 'true');
    setPct(fig, stage, clientX);
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var jump = t.closest('[data-step-jump]');
      if (!jump) return;
      var n = jump.getAttribute('data-step-jump');
      if (!n) return;
      var target = document.querySelector('[data-step="' + n + '"]');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    true
  );

  document.addEventListener(
    'pointermove',
    function (e) {
      if (e.pointerType === 'touch') return;
      var t = e.target;
      if (!(t instanceof Element)) return;
      var stage = t.closest('.share-slider-stage');
      if (stage) {
        var fig = stage.closest('.share-slider');
        if (fig) activate(fig, stage, e.clientX);
      } else if (activeFig) {
        deactivate();
      }
    },
    true
  );

  document.addEventListener(
    'pointerdown',
    function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var stage = t.closest('.share-slider-stage');
      if (!stage) return;
      var fig = stage.closest('.share-slider');
      if (!fig) return;
      activate(fig, stage, e.clientX);
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {}
    },
    true
  );

  document.addEventListener(
    'pointerup',
    function (e) {
      if (!activeStage) return;
      try {
        activeStage.releasePointerCapture(e.pointerId);
      } catch {}
    },
    true
  );

  // Pointer leaving the document entirely — stale active state otherwise
  // sticks until the next move.
  document.addEventListener(
    'pointerleave',
    function () {
      deactivate();
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var stage = t.closest('.share-slider-stage');
      if (!stage) return;
      var fig = stage.closest('.share-slider');
      if (!fig) return;
      var curStr = fig.style.getPropertyValue('--pct') || '50%';
      var cur = parseFloat(curStr) || 50;
      var step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft') {
        activeFig = fig;
        activeStage = stage;
        fig.setAttribute('data-active', 'true');
        var n = Math.max(0, cur - step);
        fig.style.setProperty('--pct', n + '%');
        stage.setAttribute('aria-valuenow', String(Math.round(n)));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        activeFig = fig;
        activeStage = stage;
        fig.setAttribute('data-active', 'true');
        var m = Math.min(100, cur + step);
        fig.style.setProperty('--pct', m + '%');
        stage.setAttribute('aria-valuenow', String(Math.round(m)));
        e.preventDefault();
      } else if (e.key === 'Escape') {
        deactivate();
      }
    },
    true
  );
})();
