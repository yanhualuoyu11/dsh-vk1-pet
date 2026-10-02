/**
 * dsh-vk1-pet — browser half.
 *
 * Registers one `shell.overlay` entry: the frame-wide floating layer that sits
 * above every column and is click-through by default, which is exactly the
 * seat a desktop pet needs. The overlay owns every animation; the host only
 * publishes balance readings, so nothing here can spend money or start a
 * request upstream.
 * @module dsh-vk1-pet/client
 */

import {
  createElement as h,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { fetchState, requestRefresh, updateSettings } from './api.js';
import {
  CHARACTERS,
  INTERVAL_CHOICES,
  SIZE_PRESETS,
  SNAP_POSITION,
  SOURCE_CHOICES,
  TABLET_HEIGHT,
  TABLET_WIDTH,
  assetUrl,
  characterOf,
  fenToString,
  layoutOf,
  releasePosition,
  sizeOf,
  spriteFileFor,
  tabletMatrix,
} from './constants.js';
import * as pet from './model.js';
import { CLASS, CSS, STYLE_ID } from './styles.js';

/** Cordis plugin name; also the settings scope and the client bundle id. */
export const name = 'dsh-vk1-pet';

/** The slot registry is the only service this plugin consumes. */
export const inject = ['slots'];

/** The overlay slot ui-layout declares for frame-wide floating surfaces. */
const SLOT = 'shell.overlay';

/** Browser-local preferences; the host owns the poll schedule instead. */
const STORAGE_PREFIX = 'dsh-vk1-pet:v1:';

/** How often the browser re-reads the host's cached state. */
const POLL_INTERVAL_MS = 2000;

/** Alpha above which a sprite pixel counts as solid for drag hit testing. */
const ALPHA_THRESHOLD = 24;

/** Resolution of the alpha mask used for click-through hit testing. */
const MASK_WIDTH = 192;
const MASK_HEIGHT = 128;

/** Smallest visible strip kept on screen while dragging. */
const KEEP_VISIBLE = 60;

/** Attribute marking the always-visible balance pill, so the menu ignores its clicks. */
const PILL_ATTR = 'data-dsh-vk1-pet-pill';

/** Read one stored preference. */
function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Write one stored preference; storage failures are never fatal. */
function writeStored(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode or a full quota: the pet still works for this session */
  }
}

/** Clamp a number into a range. */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Keep the pet canvas reachable: at least one strip stays inside the viewport.
 * @param position - candidate `{ left, bottom }`.
 * @param layout - the current canvas boxes.
 * @returns a clamped position.
 */
function clampPosition(position, layout) {
  const maxLeft = Math.max(0, window.innerWidth - KEEP_VISIBLE);
  const maxBottom = Math.max(0, window.innerHeight - KEEP_VISIBLE);
  return {
    left: Math.round(clamp(position.left, KEEP_VISIBLE - layout.width, maxLeft)),
    bottom: Math.round(clamp(position.bottom, KEEP_VISIBLE - layout.height, maxBottom)),
  };
}

/** One-line status text shared by the tooltip and the menu head. */
function statusLabel(state) {
  if (state === null) return '连接中…';
  if (state.status === 'unconfigured') return '未配置凭证';
  if (state.connected) return `已连接 · ¥${state.display ?? '--'}`;
  return state.error ?? '离线';
}

/** Status-dot colour for a host state. */
function dotColorOf(state) {
  if (state !== null && state.connected) return '#34c759';
  if (state === null) return '#ffcc00';
  if (state.status === 'unconfigured') return '#ff3b30';
  return state.error === null ? '#ffcc00' : '#ff3b30';
}

/** One popover menu row. */
function MenuItem({ disabled = false, title, onSelect, children }) {
  return h('button', {
    type: 'button',
    title,
    disabled,
    className: `${CLASS.menuItem}${disabled ? ` ${CLASS.menuItemDisabled}` : ''}`,
    onClick: disabled ? undefined : (event) => { event.stopPropagation(); onSelect(); },
  }, children);
}

/** One labelled chip row. */
function ChipRow({ label, options, value, onSelect }) {
  return h('div', null,
    h('div', { className: CLASS.menuGroupLabel }, label),
    h('div', { className: CLASS.menuChips }, options.map((option) => h('button', {
      key: option.id,
      type: 'button',
      title: option.title,
      disabled: option.disabled === true,
      className: `${CLASS.menuChip}${option.id === value ? ` ${CLASS.menuChipOn}` : ''}${option.disabled === true ? ` ${CLASS.menuChipOff}` : ''}`,
      onClick: option.disabled === true ? undefined : (event) => { event.stopPropagation(); onSelect(option.id); },
    }, option.title))));
}

/** Popover anchored at a viewport point, flipped up when it would run off screen. */
function MenuShell({ point, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (event) => {
      if (ref.current !== null && ref.current.contains(event.target)) return;
      // The pill is the menu's own trigger, so its click must not close first
      // and reopen on the following click event.
      if (event.target instanceof Element && event.target.closest(`[${PILL_ATTR}]`) !== null) return;
      onClose();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const style = {
    left: clamp(point.x, 8, Math.max(8, window.innerWidth - 276)),
    pointerEvents: 'auto',
  };
  if (point.y > window.innerHeight * 0.55) style.bottom = clamp(window.innerHeight - point.y, 8, window.innerHeight - 40);
  else style.top = clamp(point.y, 8, Math.max(8, window.innerHeight - 40));

  return h('div', { ref, className: CLASS.menu, style, role: 'menu' }, children);
}

/**
 * The pet itself: sprite, tablet readout, animations, drag, and menu.
 * @returns the overlay content.
 */
function PetOverlay() {
  const [hostState, setHostState] = useState(null);
  const [sideId, setSideId] = useState(() => {
    const stored = readStored('size', 'medium');
    return SIZE_PRESETS.some((entry) => entry.id === stored) ? stored : 'medium';
  });
  const [characterId, setCharacterId] = useState(() => {
    const stored = readStored('character', 'deepseek');
    return CHARACTERS.some((entry) => entry.id === stored) ? stored : 'deepseek';
  });
  const [position, setPosition] = useState(() => {
    const stored = readStored('position', null);
    if (stored === null || typeof stored.left !== 'number' || typeof stored.bottom !== 'number') return SNAP_POSITION;
    return { left: stored.left, bottom: stored.bottom };
  });
  const [hidden, setHidden] = useState(() => readStored('hidden', false) === true);
  const [snapOnRelease, setSnapOnRelease] = useState(() => readStored('snap', true) !== false);
  const [soundOn, setSoundOn] = useState(() => readStored('sound', true) !== false);
  const [menuPoint, setMenuPoint] = useState(null);
  const [interactive, setInteractive] = useState(false);
  const [, setFrame] = useState(0);
  const [amountScale, setAmountScale] = useState(1);
  const [busy, setBusy] = useState(false);

  const modelRef = useRef(null);
  if (modelRef.current === null) modelRef.current = pet.createModel();
  const rootRef = useRef(null);
  const amountRef = useRef(null);
  const maskRef = useRef(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const dragRef = useRef(null);
  const lastRevisionRef = useRef(null);
  const snapNextRef = useRef(true);
  const audiosRef = useRef(null);
  const audioIndexRef = useRef(0);

  const character = useMemo(() => characterOf(characterId), [characterId]);
  const side = useMemo(() => sizeOf(sideId).side, [sideId]);
  const layout = useMemo(() => layoutOf(side), [side]);

  // Live mirrors of state the animation loop and pointer helpers read without
  // wanting to be re-created on every change.
  const soundRef = useRef(soundOn);
  const snapRef = useRef(snapOnRelease);
  const sideRef = useRef(side);
  const layoutRef = useRef(layout);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  useEffect(() => { snapRef.current = snapOnRelease; }, [snapOnRelease]);
  useEffect(() => { sideRef.current = side; }, [side]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  const model = modelRef.current;
  const connected = hostState !== null && hostState.connected === true;
  const offlineArt = character.id === 'deepseek' && !connected;
  const spriteSrc = useMemo(() => assetUrl(spriteFileFor(character, connected)), [character, connected]);
  const dotColor = dotColorOf(hostState);

  /** Persist a settled position (never one written per drag frame). */
  const commitPosition = useCallback((next) => {
    setPosition(next);
    writeStored('position', next);
  }, []);

  useEffect(() => { writeStored('size', sideId); }, [sideId]);
  useEffect(() => { writeStored('character', characterId); }, [characterId]);
  useEffect(() => { writeStored('hidden', hidden); }, [hidden]);
  useEffect(() => { writeStored('snap', snapOnRelease); }, [snapOnRelease]);
  useEffect(() => { writeStored('sound', soundOn); }, [soundOn]);

  /** Play the original hit sound once. */
  const playHit = useCallback(() => {
    try {
      if (audiosRef.current === null) {
        audiosRef.current = [0, 1, 2, 3].map(() => {
          const node = new Audio(assetUrl('hit.mp3'));
          node.preload = 'auto';
          node.volume = 0.7;
          return node;
        });
      }
      const pool = audiosRef.current;
      const node = pool[audioIndexRef.current % pool.length];
      audioIndexRef.current += 1;
      node.currentTime = 0;
      void node.play().catch(() => { /* autoplay policy, or the asset is missing */ });
    } catch {
      /* audio is best-effort */
    }
  }, []);

  /** Run animation frames until the model is idle again. */
  const ensureAnimation = useCallback(() => {
    if (rafRef.current !== 0) return;
    lastTsRef.current = 0;
    const step = (timestamp) => {
      const active = modelRef.current;
      const dt = lastTsRef.current === 0 ? 0 : Math.min(0.5, (timestamp - lastTsRef.current) / 1000);
      lastTsRef.current = timestamp;
      const hitNow = pet.tick(active, dt);
      if (hitNow && soundRef.current) playHit();
      setFrame((value) => (value + 1) % 1000000);
      if (pet.needsFrame(active)) rafRef.current = window.requestAnimationFrame(step);
      else {
        rafRef.current = 0;
        lastTsRef.current = 0;
      }
    };
    rafRef.current = window.requestAnimationFrame(step);
  }, [playHit]);

  useEffect(() => () => {
    if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  // Poll the host's cached state. This is a memory read on the host, so the
  // browser may poll far more often than the upstream balance is refreshed.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const next = await fetchState();
        if (alive) setHostState(next);
      } catch {
        /* the host may still be starting; the next tick retries */
      }
    };
    void pull();
    const timer = window.setInterval(() => { void pull(); }, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Fold each new host revision into the animation model exactly once.
  useEffect(() => {
    if (hostState === null) return;
    if (lastRevisionRef.current === hostState.revision) return;
    lastRevisionRef.current = hostState.revision;
    const active = modelRef.current;
    const snap = snapNextRef.current;
    snapNextRef.current = false;
    if (hostState.status === 'unconfigured') pet.resetModel(active);
    else if (typeof hostState.fen === 'number') pet.applyReading(active, hostState.fen, { snap });
    if (pet.needsFrame(active)) ensureAnimation();
    else setFrame((value) => (value + 1) % 1000000);
  }, [hostState, ensureAnimation]);

  // Build the alpha mask used for per-pixel click-through.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = MASK_WIDTH;
        canvas.height = MASK_HEIGHT;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) return;
        context.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
        context.drawImage(image, 0, 0, MASK_WIDTH, MASK_HEIGHT);
        maskRef.current = {
          alpha: context.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data,
          width: MASK_WIDTH,
          height: MASK_HEIGHT,
        };
      } catch {
        maskRef.current = null;
      }
    };
    image.onerror = () => { maskRef.current = null; };
    image.src = spriteSrc;
    return () => { cancelled = true; };
  }, [spriteSrc]);

  // Track whether the pointer is over an opaque pixel; only then does the pet
  // take pointer events, so the character never blocks the UI underneath.
  useEffect(() => {
    if (hidden) {
      setInteractive(false);
      return undefined;
    }
    const onMove = (event) => {
      if (dragRef.current !== null) return;
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const lx = event.clientX - rect.left;
      const ly = event.clientY - rect.top;
      const boxes = layoutOf(sideRef.current);
      const inside = lx >= boxes.spriteLeft && lx <= boxes.spriteLeft + boxes.spriteWidth
        && ly >= boxes.spriteTop && ly <= boxes.spriteTop + boxes.spriteHeight;
      if (!inside) {
        setInteractive((previous) => (previous ? false : previous));
        return;
      }
      const mask = maskRef.current;
      if (mask === null) {
        // Before the mask decodes (or if it cannot be read) fall back to the
        // sprite's bounding box rather than making the pet undraggable.
        setInteractive((previous) => (previous ? previous : true));
        return;
      }
      const mx = clamp(Math.floor(((lx - boxes.spriteLeft) / boxes.spriteWidth) * mask.width), 0, mask.width - 1);
      const my = clamp(Math.floor(((ly - boxes.spriteTop) / boxes.spriteHeight) * mask.height), 0, mask.height - 1);
      const alpha = mask.alpha[(my * mask.width + mx) * 4 + 3];
      const next = alpha > ALPHA_THRESHOLD;
      setInteractive((previous) => (previous === next ? previous : next));
    };
    document.addEventListener('pointermove', onMove, true);
    return () => document.removeEventListener('pointermove', onMove, true);
  }, [hidden]);

  // Keep a dragged or resized pet reachable.
  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        const next = clampPosition(current, layoutOf(sideRef.current));
        writeStored('position', next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimization, not a requirement */
    }
    element.dataset.dragging = 'true';
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: position.left,
      originBottom: position.bottom,
      // The position of the most recent pointermove, so the release commits
      // where the pet actually was dropped rather than where it started.
      last: null,
      moved: false,
    };
  }, [position.left, position.bottom]);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const next = clampPosition({ left: drag.originLeft + dx, bottom: drag.originBottom - dy }, layoutRef.current);
    drag.last = next;
    setPosition(next);
  }, []);

  const onPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const element = event.currentTarget;
    delete element.dataset.dragging;
    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    const settled = releasePosition(drag, snapRef.current);
    if (settled !== null) commitPosition(clampPosition(settled, layoutRef.current));
  }, [commitPosition]);

  const openMenu = useCallback((event) => {
    if (event !== null && event !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setMenuPoint({ x: event.clientX, y: event.clientY });
      return;
    }
    const boxes = layoutRef.current;
    setMenuPoint({ x: position.left, y: window.innerHeight - position.bottom - boxes.height });
  }, [position.left, position.bottom]);

  const closeMenu = useCallback(() => setMenuPoint(null), []);

  const runRefresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    snapNextRef.current = true;
    try {
      setHostState(await requestRefresh());
    } catch {
      snapNextRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const changeInterval = useCallback(async (seconds) => {
    setBusy(true);
    try {
      setHostState(await updateSettings({ intervalSeconds: seconds }));
    } catch {
      /* the menu keeps showing the previous value */
    } finally {
      setBusy(false);
    }
  }, []);

  const changeSource = useCallback(async (source) => {
    setBusy(true);
    snapNextRef.current = true;
    try {
      setHostState(await updateSettings({ source }));
    } catch {
      snapNextRef.current = false;
    } finally {
      setBusy(false);
    }
  }, []);

  const shake = pet.shakeOffset(model, side);
  const impact = pet.impact(model);
  const displayFen = pet.displayedFen(model);
  const displayText = fenToString(displayFen);
  // The readout sits on the tablet painted INTO the artwork, not on a theme
  // surface, so these colours are deliberately fixed: every character's screen
  // is dark in all four PNGs, and a `--dsw-` token would flip them to
  // unreadable in the light theme. Theme tokens belong on the menu and pill,
  // which do sit on the app's own surfaces.
  const amountColor = connected ? 'rgb(240, 247, 255)' : 'rgb(173, 186, 207)';
  const rateLimited = hostState !== null && hostState.rateLimitedUntil !== null
    && hostState.rateLimitedUntil > Date.now();

  // Fit a long balance inside the tablet instead of clipping significant
  // digits. The measurement is layout-only (`offsetWidth` ignores the applied
  // transform), so it only needs to re-run when the text or the size changes —
  // never once per animation frame.
  useLayoutEffect(() => {
    const element = amountRef.current;
    if (element === null) return;
    const full = element.offsetWidth;
    const next = full > TABLET_WIDTH * 0.9 ? (TABLET_WIDTH * 0.9) / full : 1;
    setAmountScale((previous) => (Math.abs(previous - next) > 0.002 ? next : previous));
  }, [displayText, side]);

  const petNode = hidden ? null : h('div', {
    ref: rootRef,
    className: CLASS.root,
    'aria-label': `DSH 余额桌宠 · ${character.title}`,
    title: `${statusLabel(hostState)} · 拖动移动，右键打开菜单`,
    style: {
      left: `${position.left}px`,
      bottom: `${position.bottom}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      pointerEvents: interactive ? 'auto' : 'none',
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onContextMenu: openMenu,
  },
  model.topupTime > 0 ? (() => {
    const progress = 1 - model.topupTime / pet.TOPUP_DURATION;
    const inset = side * (0.03 + 0.06 * (1 - progress));
    const alpha = 0.8 * (1 - progress);
    return h('span', {
      className: CLASS.ring,
      style: {
        left: `${layout.spriteLeft + inset}px`,
        top: `${layout.spriteTop + inset}px`,
        width: `${Math.max(0, layout.spriteWidth - inset * 2)}px`,
        height: `${Math.max(0, layout.spriteHeight - inset * 2)}px`,
        border: `${Math.max(1, side * 0.015)}px solid rgba(52, 199, 89, ${alpha.toFixed(3)})`,
      },
    });
  })() : null,
  h('div', {
    className: CLASS.shake,
    style: {
      left: `${layout.spriteLeft}px`,
      top: `${layout.spriteTop}px`,
      width: `${layout.spriteWidth}px`,
      height: `${layout.spriteHeight}px`,
      transform: `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px)`,
    },
  },
  h('img', { className: CLASS.image, src: spriteSrc, alt: '', draggable: false }),
  impact > 0 ? h('span', {
    className: CLASS.flash,
    style: {
      background: `rgba(255, 26, 36, ${(0.45 * impact).toFixed(3)})`,
      WebkitMaskImage: `url("${spriteSrc}")`,
      maskImage: `url("${spriteSrc}")`,
    },
  }) : null,
  offlineArt ? null : h('div', {
    className: CLASS.tablet,
    style: {
      width: `${TABLET_WIDTH}px`,
      height: `${TABLET_HEIGHT}px`,
      // The shake layer's origin is the sprite's top-left corner, so the
      // artwork corners map into it without the canvas offset.
      transform: tabletMatrix({ spriteLeft: 0, spriteTop: 0, scale: layout.scale }, character.corners),
    },
  },
  h('span', {
    className: CLASS.tabletTitle,
    style: {
      top: `${TABLET_HEIGHT * 0.2}px`,
      fontSize: `${TABLET_HEIGHT * 0.21}px`,
      lineHeight: 1,
      color: 'rgb(158, 184, 227)',
      transform: 'translateY(-50%)',
    },
  }, 'DSH 余额'),
  h('span', {
    ref: amountRef,
    className: CLASS.tabletAmount,
    style: {
      top: `${TABLET_HEIGHT * 0.68}px`,
      transform: `translate(-50%, -50%) scale(${amountScale.toFixed(4)})`,
      color: amountColor,
    },
  },
  h('span', { className: CLASS.tabletCurrency, style: { fontSize: `${TABLET_HEIGHT * 0.27}px` } }, '¥ '),
  h('span', { className: CLASS.tabletNumber, style: { fontSize: `${TABLET_HEIGHT * 0.48}px` } }, displayText)),
  h('span', {
    className: CLASS.tabletDot,
    style: {
      left: `${TABLET_WIDTH * 0.92}px`,
      top: `${TABLET_HEIGHT * 0.23 - 15}px`,
      width: '15px',
      height: '15px',
      background: dotColor,
    },
  })),
  // 「不显示余额标题、金额、状态点或金额飘字」: with the whale showing the
  // holding-basin art there is no reading to attach a number to, so a floating
  // "-0.01" would be the only figure on screen and would read as a real
  // deduction. The hit itself is not suppressed — shake, red flash, the top-up
  // ring, and the sound effect all still play.
  ...(offlineArt ? [] : model.floating.map((label) => {
    const progress = Math.min(1, label.age / pet.FLOAT_LIFETIME);
    const alpha = Math.max(0, 1 - Math.pow(progress, 1.6));
    return h('span', {
      key: label.id,
      className: `${CLASS.float} ${label.tone === 'topup' ? CLASS.floatTopup : CLASS.floatHit}`,
      style: {
        left: `${side}px`,
        top: `${side * (0.55 - 0.45 * progress)}px`,
        fontSize: `${side * 0.08}px`,
        opacity: alpha.toFixed(3),
        transform: 'translateX(-50%)',
        textShadow: `0 0 ${(side * 0.022).toFixed(2)}px rgba(0, 0, 0, ${(0.4 * alpha).toFixed(3)})`,
      },
    }, label.text);
  }))));

  const menu = menuPoint === null ? null : h(MenuShell, { point: menuPoint, onClose: closeMenu },
    h('div', { className: CLASS.menuHead },
      h('div', { className: CLASS.menuTitle }, statusLabel(hostState)),
      h('div', { className: CLASS.menuMeta },
        hostState === null ? '读取主机状态…'
          : hostState.source === null ? '凭证：未配置'
            : `凭证：${hostState.source}${hostState.detail === null ? '' : ` · ${hostState.detail}`}`),
      hostState !== null && hostState.spentDisplay !== null
        ? h('div', { className: CLASS.menuMeta }, `累计消费 ¥${hostState.spentDisplay}`)
        : null,
      hostState !== null && hostState.error !== null
        ? h('div', { className: CLASS.menuError }, hostState.error)
        : null),
    h('div', { className: CLASS.menuSep }),
    h(MenuItem, {
      disabled: busy || rateLimited,
      onSelect: () => { void runRefresh(); },
    }, busy ? '刷新中…' : rateLimited ? '限流等待中…' : '立即刷新余额'),
    h(MenuItem, { onSelect: () => { pet.playDemo(modelRef.current, 1); ensureAnimation(); } }, '测试一次扣费'),
    h(MenuItem, { onSelect: () => { pet.playDemo(modelRef.current, 5); ensureAnimation(); } }, '演示连续扣费 ×5'),
    h('div', { className: CLASS.menuSep }),
    h(ChipRow, {
      label: '角色',
      options: CHARACTERS.map((entry) => ({ id: entry.id, title: entry.title })),
      value: characterId,
      onSelect: setCharacterId,
    }),
    h(ChipRow, {
      label: '尺寸（角色高度）',
      options: SIZE_PRESETS.map((entry) => ({ id: entry.id, title: `${entry.title} ${entry.side}` })),
      value: sideId,
      onSelect: setSideId,
    }),
    h('div', { className: CLASS.menuSep }),
    h(MenuItem, { onSelect: () => setSnapOnRelease((value) => !value) }, snapOnRelease ? '✓ 松手吸附左下角' : '　松手吸附左下角'),
    h(MenuItem, { onSelect: () => setSoundOn((value) => !value) }, soundOn ? '✓ 音效' : '　音效'),
    h('div', { className: CLASS.menuSep }),
    h(ChipRow, {
      label: '刷新间隔',
      options: INTERVAL_CHOICES.map((seconds) => ({
        id: String(seconds),
        title: seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`,
      })),
      value: hostState === null ? '30' : String(hostState.intervalSeconds),
      onSelect: (id) => { void changeInterval(Number(id)); },
    }),
    h(ChipRow, {
      label: '凭证来源',
      options: SOURCE_CHOICES,
      value: hostState === null ? 'auto' : hostState.sourcePreference,
      onSelect: (id) => { void changeSource(id); },
    }),
    h('div', { className: CLASS.menuSep }),
    h(MenuItem, {
      onSelect: () => { commitPosition(clampPosition(SNAP_POSITION, layoutRef.current)); closeMenu(); },
    }, '吸附回左下角'),
    h(MenuItem, { onSelect: () => { setHidden(true); closeMenu(); } }, '隐藏桌宠'));

  // The pill rides just above the pet, exactly where the pet would be if it were
  // visible, so hiding the pet never drops the control onto the sidebar's own
  // bottom row.
  const pillBottom = clamp(position.bottom + layout.height + 6, 8, Math.max(8, window.innerHeight - 34));
  const pillLeft = clamp(position.left, 8, Math.max(8, window.innerWidth - 130));

  const pill = h('button', {
    type: 'button',
    [PILL_ATTR]: '',
    className: `${CLASS.pill}${hidden ? ` ${CLASS.pillHidden}` : ''}`,
    style: { left: `${pillLeft}px`, bottom: `${pillBottom}px`, pointerEvents: 'auto' },
    title: 'DSH 余额桌宠 · 点击打开菜单',
    onClick: (event) => {
      event.stopPropagation();
      if (menuPoint !== null) {
        closeMenu();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPoint({ x: rect.left, y: rect.top });
    },
    onContextMenu: (event) => {
      event.preventDefault();
      setMenuPoint({ x: event.clientX, y: event.clientY });
    },
  },
  h('span', { className: CLASS.pillDot, style: { background: dotColor } }),
  h('span', null, displayFen === null ? '¥ --' : `¥ ${displayText}`),
  hidden ? h('span', null, '（已隐藏）') : null);

  return h('div', { 'data-dsh-vk1-pet': '', style: { display: 'contents' } }, petNode, pill, menu);
}

/**
 * Load the browser half.
 * @param ctx - client root context; `ctx.slots` is ready before `apply` runs.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = name;
    tag.dataset.pluginCss = STYLE_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => { tag.remove(); };
  }, 'dsh-vk1-pet: styles');

  ctx.effect(
    () => ctx.slots.inject(SLOT, () => ctx.slots.register({
      name: SLOT,
      id: 'vk1-pet',
      order: 50,
    }, PetOverlay)),
    'dsh-vk1-pet: overlay entry',
  );
}
