(function () {
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

  var figs = document.querySelectorAll('.share-slider');
  for (var i = 0; i < figs.length; i++) {
    (function (fig) {
      var stage = fig.querySelector('.share-slider-stage');
      if (!stage) return;
      var hasDiff = fig.getAttribute('data-has-diff') === 'true';
      function setPct(clientX) {
        var rect = stage.getBoundingClientRect();
        if (!rect.width) return;
        var x = clientX - rect.left;
        var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        fig.style.setProperty('--pct', pct.toFixed(2) + '%');
        stage.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      function activate() {
        fig.setAttribute('data-active', 'true');
      }
      function deactivate() {
        if (hasDiff) fig.setAttribute('data-active', 'false');
      }
      stage.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch') return;
        activate();
        setPct(e.clientX);
      });
      stage.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'touch') return;
        deactivate();
      });
      stage.addEventListener('pointermove', function (e) {
        if (fig.getAttribute('data-active') !== 'true') return;
        setPct(e.clientX);
      });
      stage.addEventListener('pointerdown', function (e) {
        activate();
        setPct(e.clientX);
        try {
          stage.setPointerCapture(e.pointerId);
        } catch (err) {}
      });
      stage.addEventListener('pointerup', function (e) {
        try {
          stage.releasePointerCapture(e.pointerId);
        } catch (err) {}
      });
      stage.addEventListener('keydown', function (e) {
        var curStr = fig.style.getPropertyValue('--pct') || '50%';
        var cur = parseFloat(curStr) || 50;
        var step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft') {
          activate();
          var n = Math.max(0, cur - step);
          fig.style.setProperty('--pct', n + '%');
          stage.setAttribute('aria-valuenow', String(Math.round(n)));
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          activate();
          var m = Math.min(100, cur + step);
          fig.style.setProperty('--pct', m + '%');
          stage.setAttribute('aria-valuenow', String(Math.round(m)));
          e.preventDefault();
        } else if (e.key === 'Escape') {
          deactivate();
        }
      });
    })(figs[i]);
  }
})();
