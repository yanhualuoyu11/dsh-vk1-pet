/**
 * Stylesheet for the pet overlay.
 *
 * Everything is injected as one `<style data-plugin>` tag at materialization
 * and removed with the plugin fiber, which is how every browser plugin in this
 * client ships CSS. Only two rules need real keyframes; the rest of the motion
 * is per-frame transforms written by the animation loop.
 * @module dsh-vk1-pet/client/styles
 */

/** Tag id recorded on the injected `<style>` element. */
export const STYLE_ID = 'dsh-vk1-pet/styles';

/** Shared class names, so the JSX holds no string literals. */
export const CLASS = {
  root: 'vk1p-root',
  shake: 'vk1p-shake',
  image: 'vk1p-image',
  flash: 'vk1p-flash',
  ring: 'vk1p-ring',
  tablet: 'vk1p-tablet',
  tabletTitle: 'vk1p-tablet-title',
  tabletAmount: 'vk1p-tablet-amount',
  tabletCurrency: 'vk1p-tablet-currency',
  tabletNumber: 'vk1p-tablet-number',
  tabletDot: 'vk1p-tablet-dot',
  float: 'vk1p-float',
  floatHit: 'vk1p-float-hit',
  floatTopup: 'vk1p-float-topup',
  menu: 'vk1p-menu',
  menuHead: 'vk1p-menu-head',
  menuTitle: 'vk1p-menu-title',
  menuMeta: 'vk1p-menu-meta',
  menuError: 'vk1p-menu-error',
  menuSep: 'vk1p-menu-sep',
  menuItem: 'vk1p-menu-item',
  menuItemDisabled: 'vk1p-menu-item-disabled',
  menuGroupLabel: 'vk1p-menu-group-label',
  menuChips: 'vk1p-menu-chips',
  menuChip: 'vk1p-menu-chip',
  menuChipOn: 'vk1p-menu-chip-on',
  menuChipOff: 'vk1p-menu-chip-off',
  pill: 'vk1p-pill',
  pillDot: 'vk1p-pill-dot',
  pillHidden: 'vk1p-pill-hidden',
};

/**
 * The full stylesheet text.
 *
 * The pet root is click-through by default; the component flips
 * `pointer-events` to `auto` only while the pointer is over an opaque sprite
 * pixel, so the character never blocks the UI underneath.
 */
export const CSS = `
.${CLASS.root} {
  position: fixed;
  z-index: 30;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  cursor: grab;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
.${CLASS.root}:active { cursor: grabbing; }
.${CLASS.root}[data-dragging="true"] { cursor: grabbing; }

.${CLASS.shake} {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
}

.${CLASS.image} {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  -webkit-user-drag: none;
}

/* Source-atop tint: the sprite's own alpha becomes the mask, so the character's
   soft edge survives instead of the transparent background filling in. */
.${CLASS.flash} {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.${CLASS.ring} {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.${CLASS.tablet} {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
  pointer-events: none;
}
.${CLASS.tabletTitle},
.${CLASS.tabletAmount} {
  position: absolute;
  white-space: nowrap;
}
.${CLASS.tabletTitle} {
  left: 0;
  right: 0;
  text-align: center;
  font-weight: 700;
  text-shadow: 1.5px 1.5px 1.5px rgba(0, 0, 0, 0.65);
}
.${CLASS.tabletAmount} {
  left: 50%;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-shadow: 1.5px 1.5px 1.5px rgba(0, 0, 0, 0.65);
}
.${CLASS.tabletCurrency} { font-weight: 700; }
.${CLASS.tabletNumber} {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.${CLASS.tabletDot} {
  position: absolute;
  border-radius: 50%;
}

.${CLASS.float} {
  position: absolute;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  will-change: transform, opacity;
}
.${CLASS.floatHit} { color: #ff3b30; }
.${CLASS.floatTopup} { color: #34c759; }

.${CLASS.menu} {
  position: fixed;
  z-index: 40;
  pointer-events: auto;
  box-sizing: border-box;
  width: 268px;
  max-height: min(560px, calc(100vh - 24px));
  overflow-y: auto;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1, #ffffff));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  color: var(--dsw-alias-label-primary, #1f2329);
  font-size: 13px;
  line-height: 18px;
  cursor: default;
}
.${CLASS.menuHead} { padding: 8px 10px 6px; }
.${CLASS.menuTitle} { font-weight: 600; }
.${CLASS.menuMeta} {
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  font-size: 12px;
  word-break: break-all;
}
.${CLASS.menuError} { color: #ff3b30; font-size: 12px; word-break: break-all; }
.${CLASS.menuSep} {
  height: 1px;
  margin: 6px 4px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}
.${CLASS.menuItem} {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 0;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.${CLASS.menuItem}:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}
.${CLASS.menuItemDisabled},
.${CLASS.menuItemDisabled}:hover {
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  background: transparent;
  cursor: default;
}
.${CLASS.menuGroupLabel} {
  padding: 8px 10px 2px;
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  font-size: 11px;
  letter-spacing: 0.04em;
}
.${CLASS.menuChips} {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 10px 8px;
}
.${CLASS.menuChip} {
  font: inherit;
  font-size: 12px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.${CLASS.menuChipOn} {
  border-color: transparent;
  /* The official pairing: the brand fill flips to a near-white surface in the
     dark theme, so the text must come from the foreground token that flips with
     it. A literal #fff reads as white-on-white there. */
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe));
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.${CLASS.menuChipOff} { opacity: 0.55; cursor: default; }

.${CLASS.pill} {
  position: fixed;
  z-index: 30;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1, #ffffff));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  color: var(--dsw-alias-label-primary, #1f2329);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.15s ease;
}
.${CLASS.pill}:hover { opacity: 1; }
.${CLASS.pillHidden} { opacity: 0.45; }
.${CLASS.pillDot} {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

@media (prefers-reduced-motion: reduce) {
  .${CLASS.pill} { transition: none; }
}
`;
