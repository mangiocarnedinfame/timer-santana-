// app.js - aggiunta pause/resume toccando il centro, e fix picker/footer mobile
(() => {
  // DOM elements
  const clockWrap = document.getElementById('clockWrap');
  const timeLabel = document.getElementById('timeLabel');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  const overlay = document.getElementById('pickerOverlay');
  const minutesWheel = document.getElementById('minutesWheel');
  const secondsWheel = document.getElementById('secondsWheel');
  const confirmPicker = document.getElementById('confirmPicker');
  const cancelPicker = document.getElementById('cancelPicker');

  const ring = document.querySelector('.ring');

  // config
  const MAX_MIN = 59;
  const MAX_SEC = 59;

  // state
  let selectedMin = 0, selectedSec = 30;
  let duration = selectedMin * 60 + selectedSec;
  let rafId = null;
  let startTs = null;
  let remaining = 0;
  let wakeLock = null;
  let audioCtx = null;

  // pause/resume specific
  let isPaused = false;
  let pausedRemaining = 0;
  let totalDurationOnRun = 0; // duration used for current run (countdown base)

  // SVG radius math
  const R = 88;
  const C = 2 * Math.PI * R;
  if (ring) {
    ring.style.strokeDasharray = `${C}px`;
    ring.style.strokeDashoffset = `0px`;
  }

  // helpers
  function pad(n){ return String(n).padStart(2,'0') }
  function updateLabel(min, sec){
    timeLabel.textContent = `${pad(min)}:${pad(sec)}`;
  }
  updateLabel(selectedMin, selectedSec);

  // ---------------- wheel build / selection (unchanged logic but robust) ----------------
  function buildWheel(container, max){
    const prev = container.querySelector('.list');
    if (prev) prev.remove();

    const ul = document.createElement('ul');
    ul.className = 'list';
    for(let i=0;i<=max;i++){
      const li = document.createElement('li');
      li.className = 'wheel-item';
      li.dataset.value = String(i);
      li.textContent = pad(i);
      ul.appendChild(li);
    }
    container.appendChild(ul);

    requestAnimationFrame(() => {
      const firstItem = ul.querySelector('.wheel-item');
      if (!firstItem) return;
      const itemH = Math.round(firstItem.getBoundingClientRect().height) || 56;
      const containerH = Math.round(container.getBoundingClientRect().height) || (window.innerHeight - 220);
      const spacerH = Math.max(0, Math.round((containerH - itemH) / 2));
      const topSpacer = document.createElement('li');
      topSpacer.className = 'spacer';
      topSpacer.style.height = `${spacerH}px`;
      const bottomSpacer = topSpacer.cloneNode();
      ul.insertBefore(topSpacer, ul.firstChild);
      ul.appendChild(bottomSpacer);

      requestAnimationFrame(() => {
        const initial = (container === minutesWheel) ? selectedMin : selectedSec;
        scrollToValue(container, initial);
        markSelected(ul, Number(initial));
      });
    });
    return ul;
  }

  function markSelected(list, value){
    if (!list) return;
    const items = Array.from(list.querySelectorAll('.wheel-item'));
    if (items.length === 0) return;
    const parentRect = list.parentElement.getBoundingClientRect();
    const centerY = parentRect.top + parentRect.height/2;
    items.forEach(li => {
      const num = Number(li.dataset.value);
      if (num === value) li.classList.add('selected');
      else li.classList.remove('selected');

      const rect = li.getBoundingClientRect();
      const dist = (rect.top + rect.height/2) - centerY;
      const norm = Math.max(-1, Math.min(1, -dist / 160));
      const rotate = norm * 16;
      const translate = Math.abs(norm) * -32;
      const scale = 1 + (1 - Math.abs(norm)) * 0.06;
      li.style.transform = `rotateX(${rotate}deg) translateZ(${translate}px) scale(${scale})`;
      li.style.opacity = `${0.55 + (1 - Math.abs(norm)) * 0.5}`;
    });
  }

  function scrollToValue(container, value){
    const list = container.querySelector('.list');
    if (!list) return;
    const item = list.querySelector(`.wheel-item[data-value="${value}"]`);
    if (!item) return;
    const itemH = item.getBoundingClientRect().height;
    const parentH = container.getBoundingClientRect().height;
    const target = item.offsetTop - (parentH/2 - itemH/2);
    try { container.scrollTo({ top: target, behavior: 'smooth' }); }
    catch(e){ container.scrollTop = target; }
  }

  function setupWheelBehavior(container, list, max, onSelect){
    if (container._scrollHandler) { container.removeEventListener('scroll', container._scrollHandler); container._scrollHandler = null; }
    if (container._keyHandler) { container.removeEventListener('keydown', container._keyHandler); container._keyHandler = null; }

    let scrollTimer = null;

    const scrollHandler = () => {
      const items = Array.from((list || container).querySelectorAll('.wheel-item'));
      if (!items.length) return;
      const parentRect = container.getBoundingClientRect();
      const centerY = parentRect.top + parentRect.height/2;
      let closest = null;
      let minDist = Infinity;
      items.forEach(li => {
        const rect = li.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.height/2) - centerY);
        if (dist < minDist){ minDist = dist; closest = li; }
      });
      if (!closest) return;
      const v = Number(closest.dataset.value);
      markSelected(list, v);

      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(()=> {
        scrollToValue(container, v);
        onSelect(v);
      }, 120);
    };

    const keyHandler = (e) => {
      const key = e.key;
      const cur = (container === minutesWheel) ? selectedMin : selectedSec;
      if (key === 'ArrowUp' || key === 'PageUp'){ e.preventDefault(); const nxt = Math.max(0, cur - 1); scrollToValue(container, nxt); }
      else if (key === 'ArrowDown' || key === 'PageDown'){ e.preventDefault(); const nxt = Math.min(max, cur + 1); scrollToValue(container, nxt); }
      else if (key === 'Home'){ e.preventDefault(); scrollToValue(container, 0); }
      else if (key === 'End'){ e.preventDefault(); scrollToValue(container, max); }
    };

    container._scrollHandler = scrollHandler;
    container._keyHandler = keyHandler;
    container.addEventListener('scroll', scrollHandler, { passive: true });
    container.addEventListener('keydown', keyHandler);
  }

  function initWheels(){
    const minUl = buildWheel(minutesWheel, MAX_MIN);
    const secUl = buildWheel(secondsWheel, MAX_SEC);
    setupWheelBehavior(minutesWheel, minUl, MAX_MIN, v => { selectedMin = v; });
    setupWheelBehavior(secondsWheel, secUl, MAX_SEC, v => { selectedSec = v; });
    return { minUl, secUl };
  }

  let { minUl, secUl } = initWheels();

  // ---------------- pause / resume logic ----------------
  function pauseTimer(){
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    isPaused = true;
    pausedRemaining = remaining;
    // release wake lock while paused
    releaseWakeLock();
    // subtle visual feedback
    clockWrap.animate([{ transform: 'scale(1)' }, { transform: 'scale(.985)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }

  function runCountdown(total){
    // start countdown from `total` seconds
    startTs = performance.now();
    totalDurationOnRun = total;
    // ensure UI buttons
    startBtn.hidden = true;
    stopBtn.hidden = false;
    startBtn.setAttribute('aria-pressed','true');
    isPaused = false;

    // request wake lock
    requestWakeLock();

    function frame(now){
      const elapsed = (now - startTs) / 1000;
      const rem = Math.max(0, totalDurationOnRun - elapsed);
      remaining = rem;
      const pct = rem / totalDurationOnRun;
      const mm = Math.floor(rem / 60);
      const ss = Math.floor(rem % 60);
      updateLabel(mm, ss);

      // ring animation
      const offset = C * (1 - pct);
      if (ring) ring.style.strokeDashoffset = `${offset}px`;
      if (ring) ring.style.stroke = interpolateColor(pct);

      if (rem <= 0.001){
        cancelAnimationFrame(rafId);
        rafId = null;
        finishTimer();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function resumeTimer(){
    if (!isPaused) return;
    if (pausedRemaining <= 0) { isPaused = false; pausedRemaining = 0; return; }
    // start countdown from pausedRemaining
    runCountdown(pausedRemaining);
  }

  // replace previous startTimer to use runCountdown
  function startTimer(){
    duration = selectedMin * 60 + selectedSec;
    if (duration <= 0) {
      clockWrap.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 340, easing: 'ease-out' });
      return;
    }
    // visual thickness on start
    if (ring) { ring.style.transition = 'stroke-width .35s ease, stroke .3s linear'; ring.style.strokeWidth = '18'; }
    playStartSound();
    runCountdown(duration);
  }

  function stopTimer(){
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    isPaused = false;
    pausedRemaining = 0;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    startBtn.setAttribute('aria-pressed','false');
    if (ring) { ring.style.strokeWidth = '12'; ring.style.strokeDashoffset = `0px`; }
    updateLabel(selectedMin, selectedSec);
    releaseWakeLock();
  }

  function finishTimer(){
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(330, ctx.currentTime);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.28);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      o.stop(ctx.currentTime + 0.62);
    } catch(e){}

    clockWrap.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.2,1)' });

    startBtn.hidden = false;
    stopBtn.hidden = true;
    startBtn.setAttribute('aria-pressed','false');

    if (ring) { ring.style.strokeDashoffset = `${C}px`; ring.style.strokeWidth = '12'; }
    releaseWakeLock();
    updateLabel(selectedMin, selectedSec);
  }

  // start/stop buttons
  startBtn.addEventListener('click', () => {
    if (rafId || isPaused) return;
    startTimer();
  });
  stopBtn.addEventListener('click', stopTimer);

  // click on clock: open picker only if timer not running and not paused
  clockWrap.addEventListener('click', (e) => {
    if (rafId || isPaused) {
      // toggle pause/resume
      if (isPaused) resumeTimer();
      else pauseTimer();
    } else {
      openPicker();
    }
  });
  clockWrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key===' ') {
      e.preventDefault();
      if (rafId || isPaused) {
        if (isPaused) resumeTimer();
        else pauseTimer();
      } else {
        openPicker();
      }
    }
  });

  // open/close picker (rebuild wheels on open)
  function openPicker(){
    overlay.hidden = false;
    const rebuiltMin = buildWheel(minutesWheel, MAX_MIN);
    const rebuiltSec = buildWheel(secondsWheel, MAX_SEC);
    setupWheelBehavior(minutesWheel, rebuiltMin, MAX_MIN, v => { selectedMin = v; });
    setupWheelBehavior(secondsWheel, rebuiltSec, MAX_SEC, v => { selectedSec = v; });
    minUl = rebuiltMin; secUl = rebuiltSec;
    requestAnimationFrame(()=>{
      scrollToValue(minutesWheel, selectedMin);
      scrollToValue(secondsWheel, selectedSec);
      setTimeout(()=> { markSelected(minUl, selectedMin); markSelected(secUl, selectedSec); }, 140);
    });
    trapFocus(overlay);
  }

  function closePicker(){
    overlay.hidden = true;
    releaseFocusTrap();
    clockWrap.focus();
  }

  cancelPicker.addEventListener('click', closePicker);
  confirmPicker.addEventListener('click', () => {
    duration = selectedMin * 60 + selectedSec;
    if (duration <= 0){
      timeLabel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.2,1)'});
      return;
    }
    updateLabel(selectedMin, selectedSec);
    closePicker();
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePicker(); });

  // audio start
  function playStartSound(){
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, ctx.currentTime);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
      o.stop(ctx.currentTime + 0.42);
    } catch (err){ console.warn('Audio start failed', err); }
  }

  // WakeLock helpers
  async function requestWakeLock(){
    try {
      if ('wakeLock' in navigator && navigator.wakeLock.request){
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else { wakeLock = null; }
    } catch (err){ console.warn('Wake lock request failed:', err); wakeLock = null; }
  }
  async function releaseWakeLock(){
    try {
      if (wakeLock && wakeLock.release) { await wakeLock.release(); wakeLock = null; }
    } catch (err){ console.warn('Wake lock release failed', err); }
  }

  // color interpolation (unchanged)
  function interpolateColor(pct){
    function lerp(a,b,t){ return Math.round(a + (b-a)*t) }
    function hexToRgb(hex){ hex = hex.replace('#',''); return [parseInt(hex.substring(0,2),16), parseInt(hex.substring(2,4),16), parseInt(hex.substring(4,6),16)]; }
    const g = hexToRgb('4de0a6'), y = hexToRgb('ffd166'), r = hexToRgb('ff6b6b');
    let c1,c2,t;
    if (pct > 0.5){ t = (pct - 0.5) / 0.5; c1 = y; c2 = g; } else { t = pct / 0.5; c1 = r; c2 = y; }
    const rgb = [ lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t) ];
    return `rgb(${rgb.join(',')})`;
  }

  // focus trap
  let lastFocused = null;
  function trapFocus(modalRoot){
    lastFocused = document.activeElement;
    const focusable = modalRoot.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length-1];
    function keyHandler(e){
      if (e.key === 'Tab'){
        if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      } else if (e.key === 'Escape'){ closePicker(); }
    }
    modalRoot._keyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);
    requestAnimationFrame(()=> first && first.focus());
  }
  function releaseFocusTrap(){
    const modal = document.getElementById('pickerOverlay');
    if (modal && modal._keyHandler){ document.removeEventListener('keydown', modal._keyHandler); modal._keyHandler = null; }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  // initial visuals
  setTimeout(()=> {
    const maybeMin = minutesWheel.querySelector('.list');
    const maybeSec = secondsWheel.querySelector('.list');
    if (maybeMin) markSelected(maybeMin, selectedMin);
    if (maybeSec) markSelected(maybeSec, selectedSec);
    updateLabel(selectedMin, selectedSec);
  }, 220);

  // visibilitychange: try re-request wake lock if needed
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null && rafId !== null){
      await requestWakeLock();
    }
  });

  // resize/orientation: rebuild wheels when picker open
  window.addEventListener('resize', () => {
    if (!overlay.hidden){
      const rebuiltMin = buildWheel(minutesWheel, MAX_MIN);
      const rebuiltSec = buildWheel(secondsWheel, MAX_SEC);
      setupWheelBehavior(minutesWheel, rebuiltMin, MAX_MIN, v => { selectedMin = v; });
      setupWheelBehavior(secondsWheel, rebuiltSec, MAX_SEC, v => { selectedSec = v; });
      setTimeout(()=> {
        scrollToValue(minutesWheel, selectedMin);
        scrollToValue(secondsWheel, selectedSec);
      }, 120);
    }
  });
})();
