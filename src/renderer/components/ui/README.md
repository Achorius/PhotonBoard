# PhotonBoard UI — design system & rules

Everything a view needs is exported from one place:

```tsx
import { Button, IconButton, Panel, PanelHeader, PanelBody, Fader, NumberField, EmptyState, toast, confirm } from '@renderer/components/ui'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
```

The shell (top bar, navigation rail, fixture sidebar, executor bar, status bar,
dialogs, toasts, keyboard shortcuts) lives in `components/layout/` and `App.tsx`.
Views render inside `<main>`; they own their content only.

Screenshots of every view on desktop / Pi touch / tablet / phone:
`npm run screenshots` (see `scripts/dev/screenshot.mjs`). Check yours on **both** densities.

---

## 1. Tokens

All colours are CSS variables (`--pb-*` in `styles/globals.css`) exposed as Tailwind
colours. Opacity works everywhere: `bg-accent/15`, `ring-danger/60`.

| Purpose | Tailwind | Notes |
|---|---|---|
| App background, wells, fader tracks, inputs | `bg-surface-0` | darkest |
| Bars, sidebars, panels | `bg-surface-1` | |
| Cards, list rows, raised areas | `bg-surface-2` | |
| Hover, secondary buttons | `bg-surface-3` | |
| Pressed / selected neutral | `bg-surface-4` | |
| Highest (thumbs, caps) | `bg-surface-5` | |
| Popovers, menus, dialogs | `bg-surface-overlay` | with `shadow-popover` / `shadow-modal` |
| Borders | `border-line-subtle` (inside panels) · `border-line` (default) · `border-line-strong` (inputs) | plain `border` = `line` |
| Text | `text-fg-primary` · `text-fg-secondary` · `text-fg-tertiary` (AA on surface 0-2) · `text-fg-disabled` (never for information) | |
| Brand accent | `bg-accent` + `text-on-accent` (dark text!) · `text-accent-fg` for orange text | primary action, active nav, programmer |
| Go / live / running / OK | `bg-go` + `text-on-go` · `text-go-fg` | |
| Danger / blackout / delete / error | `bg-danger` + `text-on-danger` · `text-danger-fg` | |
| Warning / degraded / blinder | `bg-warning` + `text-on-warning` · `text-warning-fg` | |
| Info / **selection** | `bg-info` + `text-on-info` · `text-info-fg`; selected rows `bg-info/15..20` + `bg-info-fg` bar | |
| MIDI learn / mapped | `bg-midi` + `text-on-midi` · `text-midi-fg` / `outline-midi-fg` | |

**Colour meaning is fixed.** Orange = brand / primary / programmer. Green = playing, GO, healthy.
Red = blackout, destructive, error. Amber = warning, degraded, blinder. Blue = selection, info.
Violet = MIDI. Never use these for decoration. User colours (groups, executor columns, cue
tags) come from `SWATCH_COLORS`; tint fills with `tint(color, 0.3)` and `withAlpha(color, a)`.

Canvas / Three.js / inline SVG cannot use classes: use `palette` from `tokens.ts`
(`palette.accent`, `palette.surface2`…) — never new hex literals.

Legacy classes keep working while you migrate: `surface-0..4`, `accent`, `accent-light`,
Tailwind `gray-*` (remapped onto the graphite ramp), `.btn-*`, `.input`, `.panel`.
**Do not write new code with `gray-*`, `text-white` on accent, `.btn-*` or arbitrary hex.**

Radii: `rounded-sm` 4 · `rounded` 6 (controls) · `rounded-lg` 8 (panels, cards) · `rounded-xl` 12 (dialogs).
Shadows: `shadow-raised` (buttons), `shadow-popover`, `shadow-modal`, `shadow-glow-danger` (active Blackout only).
Motion: `duration-fast` (90ms, hovers), `duration` (150), `duration-slow` (240); default easing.
`animate-blink` (alarm), `animate-fade-in`, `animate-pop-in`. Reduced motion is honoured globally.
Z-index: `z-popover` < `z-modal` < `z-toast` < `z-tooltip`.

## 2. Typography

Inter Variable (UI) and JetBrains Mono Variable (values), bundled locally (works offline on the Pi).

| Class | Size | Use |
|---|---|---|
| `text-2xs` | 11px | captions, section labels (`uppercase tracking-[0.06em] font-semibold text-fg-tertiary`), badges, fader labels |
| `text-xs` | 12px | secondary text, table cells in dense lists, small buttons |
| `text-sm` | 13px | **base** — body, buttons, inputs, list rows |
| `text-base` | 14px | emphasized body, large buttons |
| `text-lg` | 16px | dialog titles |
| `text-xl` / `text-2xl` | 20 / 24 | big readouts only (clock, GM %) |

Nothing smaller than 11px (no `text-[9px]`/`[10px]` except dense monospace badges).
Numbers that change (levels, times, counters): add `tabular` (or `tabular-nums`).
DMX values, addresses, timecode, MIDI messages, commands: `font-mono`.

## 3. Density (compact vs touch)

`<html data-density="compact|touch">` is set by the shell: touch on coarse pointers and on
the Pi (ARM Linux Electron); the user can override (`useUiStore.getState().setDensityPreference('auto'|'compact'|'touch')` — the Settings view should expose this). JS can read it with `useDensity()`.

Sizes come from CSS variables, so **use these instead of fixed heights**:

| Tailwind | compact | touch |
|---|---|---|
| `h-control-xs` | 22 | 32 |
| `h-control-sm` | 26 | 40 |
| `h-control` | 30 | 44 |
| `h-control-lg` | 38 | 52 |
| `h-row` / `min-h-row` (list rows, table rows) | 28 | 44 |
| `w-fader` | 30 | 44 |

Also available as `w-control`, `min-h-control`, `p-…` etc. For one-off touch tweaks use the
variant `[[data-density=touch]_&]:…` (e.g. `[[data-density=touch]_&]:w-[296px]`).
Every shared component already honours density. Rule: anything tappable is ≥ `h-control` in touch.
Do not set font sizes below `text-sm` for primary content in touch layouts.

## 4. Components

### Actions
```tsx
<Button variant="primary" icon={LuPlus} onClick={add}>Add fixture</Button>   // one primary per area
<Button variant="secondary">Cancel</Button>                                   // default look
<Button variant="ghost" size="sm" icon={LuCopy}>Duplicate</Button>            // toolbars
<Button variant="danger" icon={LuTrash2}>Delete</Button> / variant="danger-outline"
<Button tone="go" active={playing} onClick={toggle}>Play</Button>             // latching toggle: solid tone when active
<Button tone="warning" onPress={() => flash(true)} onRelease={() => flash(false)}>Flash</Button>  // HOLD (touch-safe)
<Button loading={saving}>Save</Button>   <Button tooltip="Save" shortcut="Mod+S">…</Button>
<Button labelClassName="hidden xl:inline" icon={…} aria-label="Stage">Stage</Button>  // icon-only on narrow screens
<IconButton icon={LuX} label="Close" />          // label is required (aria-label + tooltip)
<ToggleButton pressed={x} onPressedChange={setX} tone="info">Solo</ToggleButton>
<SegmentedControl items={[{ value: 'all', label: 'All' }, …]} value={v} onChange={setV} />   // fullWidth, compact (narrow panels)
<Tabs items={[{ id: 'cues', label: 'Cues', badge: 4 }]} value={tab} onChange={setTab} />   // panel switching; fit = equal widths, labels truncate
<DropdownMenu items={[…]} trigger={(p) => <Button {...p} iconRight={LuChevronDown}>More</Button>} />
const ctx = useContextMenu(); <div {...ctx.bind(items)}>…</div>{ctx.menu}          // right-click + touch long-press
```
Tab and segment items also take `dot` (status dot: `true` = accent, or a tone), `badge`, and any
`data-*` / `aria-*` attribute, forwarded to the item's button (`{ id: 'cues', label: 'Cues', 'data-tab': 'cues', dot: 'warning' }`).
Context menus: `ctx.bind(items | () => items)` opens on right-click **and** on a touch/pen long-press
(iOS Safari never fires `contextmenu`); the click ending a long press is swallowed. Rows with their own
menu logic: `{...contextMenuHandlers((e) => openRowMenu(id, e))}`. `ctx.open(e, items)` still works
(right-click only). Don't spread these on an element that has its own pointer handlers (drag surfaces).
Sizes: `xs | sm | md (default) | lg`. Variants: `primary | secondary | ghost | outline | danger | danger-outline | success`.
Menu entries: `{ label, icon, shortcut, onSelect, disabled, danger, checked, description, submenu }`,
`{ type: 'separator' }`, `{ type: 'label', label }`. `submenu` may be an async loader.

### Structure
```tsx
<Panel>                                     // variant="card" (bordered) | "inset" (flush in a view)
  <PanelHeader icon={LuClapperboard} title="Scenes" count={12} actions={<IconButton …/>} />
  <PanelBody>…scrolls…</PanelBody>
</Panel>
<Section title="Timing" collapsible>…fields…</Section>    // inspector groups
<Field label="Fade in">{(id) => <NumberField … />}</Field>  // label column 96px; layout="stacked" for forms
<ToolbarGroup label="View">…</ToolbarGroup> <Divider />
<Table><THead><Tr><Th sort="asc" onSort={…}>Name</Th></Tr></THead><TBody><Tr selected interactive><Td mono align="right">1.001</Td></Tr></TBody></Table>
<ListItem title="Spot 1" subtitle="Robe MegaPointe" leading={<Icon/>} trailing={<Badge>U1</Badge>} selected live onSelect={…} />
const side = useResizable({ initial: 280, min: 200, max: 480, storageKey: 'scenes.list' }); <ResizeHandle {...side.handleProps} />
```
A view = full height flex column: a header row (`h-control-lg`, `px-3`, `border-b border-line`,
title `text-sm font-semibold`, actions right) then content panes. Gaps: 8px (`gap-2`) between
controls, 12px (`p-3`) panel padding, 16px (`gap-4`) between panels. Align to a 4px grid.

### Values
```tsx
<Fader value={v} onChange={set} defaultValue={0} label="Dim" color={getChannelTypeColor(type, name)} />  // vertical console fader
<Slider value={v} onChange={set} showValue defaultValue={255} />          // horizontal; bipolar for ±
<Encoder value={pan} onChange={setPan} format={formatDegrees} label="Pan" />
<NumberField value={fade} onChange={setFade} min={0} max={600} step={0.1} unit="s" label="In" />   // in a Field: <Field label="Fade">{(id) => <NumberField id={id} …/>}</Field>
<TextInput icon={LuSearch} value={q} onChange={…} onClear={() => setQ('')} />
<Select value={mode} onChange={setMode} options={[{ value: '13ch', label: '13 channels' }]} />   // native picker on purpose
<Switch checked={on} onChange={setOn} label="Loop" description="Restart after the last cue" />
<Checkbox checked={sel} onChange={setSel} label="…" />    // 'mixed' supported
<SwatchPicker colors={SWATCH_COLORS} value={c} onChange={setC} />   <ColorSwatch color={c} />
<ProgressBar value={0.4} tone="go" />  <LevelMeter value={level/255} />
```
Faders/sliders/encoders: drag (pointer capture), Shift or a second finger = fine, double-tap =
`defaultValue` (or `onDoubleTap`), arrows/PageUp/Home/End, `onChangeStart/End` around a drag.

### Feedback & overlays
```tsx
toast.success('Scene recorded')  toast.error('Save failed', { description: err })   // bottom-right of the view (bottom-centre on phones, top in the remote stage view); tap / swipe to dismiss
useUiStore.getState().showStatus(msg, 'info' | 'success' | 'warning' | 'error', ms)   // same slot, still supported
if (await confirm({ title: 'Delete “Verse”?', message: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' })) …
const choice = await ask({ title, actions: [{ id: 'a', label: 'A' }, …] })   // several choices
const name = await prompt({ title: 'Rename scene', defaultValue: cl.name })
<Modal open onClose title="Edit fixture" size="lg" footer={…}>…</Modal>   // focus trap, Esc, focus restore
const pop = usePopover(); <Button ref={pop.anchorRef} onClick={pop.toggle}/> <Popover {...pop.props}>…</Popover>
<Tooltip content="…" shortcut="B"><button …/></Tooltip>   // hover/keyboard only, never on touch
<EmptyState icon={LuCable} title="No fixtures patched" description="…" action={<Button variant="primary">Add fixtures</Button>} />
<Badge tone="go">LIVE</Badge>  <Badge size="xs" mono>U1</Badge>  <Tag color={g.color} selected onClick onRemove>Spots</Tag>   // interactive Tags: h-control in touch
<StatusDot tone="go" pulse label="Connected" />  <Kbd keys="Mod+Shift+S" />  <Spinner/>  <Skeleton lines={3}/>
```

### Icons
Lucide only, from `react-icons/lu` (`LuPlay`, `LuSquare`, `LuPlus`, `LuTrash2`, `LuPencil`…).
Sizes: 12 (xs), 14 (sm / inline), 16 (default), 20 (navigation). Icons inherit text colour.
Helpers: `fixtureCategoryIcon(def.categories)`, `channelTypeIcon(channel.type)`,
`effectCategoryIcon('movement'|'color'|…)`. **No emoji and no unicode pictographs** (circled plus, multiplication-x, play triangles, pictographs…) in the UI.

## 5. Formatting values (`format.ts`)

| Value | Function | Example |
|---|---|---|
| DMX level shown to operators | `formatPercent(v)` | `78%` |
| raw DMX (patch, channel sheet) | `formatDmx(v)` mono | `200` |
| address | `formatAddress(u, a)` / `formatAddressRange` | `1.001`, `1.001–016` (universe is 1-based in the UI) |
| fade / delay | `formatSeconds(s)` | `0.5s`, `2s`, `1:05.0` |
| playhead | `formatClock(s)`; timecode: `formatTimecode` (timecode-engine) | `01:05.3` |
| tempo / rate / angle | `formatBpm`, `formatHz`, `formatDegrees` | `128 BPM`, `0.5 Hz`, `45°` |
| cue position | `formatCuePosition(index, count)` | `3/8`, `–/8` |

Universes and fixture numbers are 1-based in the UI, 0-based in data.

## 6. Rules (do / don't)

**Subscriptions — performance is a feature.** The mixer runs at 40-60 Hz and publishes
`dmx-store.values` at ~25 Hz.
- Don't: `const { patch, values } = usePatchStore()` / `useDmxStore()` — whole-store subscriptions re-render on every change, including at mixer rate.
- Do: `const patch = usePatchStore((s) => s.patch)`; several fields: `useShallow`; actions: `usePatchStore.getState().selectFixture(id)` inside handlers.
- Do: Live values (`useDmxUniverse(u)`, MIDI `lastMessage`, timeline time) only in the **small leaf component** that displays them; memoise rows (`memo`) and pass primitives.
- Do: Polling: ≤ 4 Hz, `setState` only when the value changed. Never `setInterval` + whole objects.

**Input.**
- Do: Pointer events (`onPointerDown/Move/Up/Cancel`, `onLostPointerCapture`) with pointer capture — use `usePointerDrag`, `usePress`.
- Don't: `onMouseDown/Up/Leave`, HTML5 drag-and-drop (`draggable`, `onDragStart`) — they do not work with fingers on the Pi. Long-press-then-drag (see `ExecutorBar.tsx`) for rearranging on touch.
- Do: `touch-none` (or `.touch-none-surface`) on drag surfaces, canvases, pads — nowhere else. Scroll containers pan natively.
- Do: Right-click actions must also be reachable on touch: `ctx.bind(items)` / `contextMenuHandlers` (long-press, iOS included), or a visible "…" menu.
- Do: Hold actions (flash, blinder, trigger) release on pointerup, pointercancel, lost capture, blur **and** unmount.
- Do: Every icon-only control has a label (`IconButton label`); every input has a label.

**Safety.** Confirm before destructive actions (`confirm({ tone: 'danger', confirmLabel: 'Delete …' })`)
with a specific verb; never confirm routine actions. Live-show controls must not fire on accidental
touches: prefer tap-on-release for toggles, explicit edit/arrange modes for rearranging.

**Empty states.** Every list, grid or canvas that can be empty shows `<EmptyState>` with what is
missing and the one action that fixes it — never a blank panel or a lone grey sentence.

**Keyboard.** Global shortcuts live in `hooks/useKeyboardShortcuts.ts` (`SHORTCUT_GROUPS` feeds the
`?` cheat sheet). View-local keys: handle them on the focused element, `stopPropagation` keys you
consume, ignore `e.repeat` for actions, and never bind single keys globally from a view.

**Classes.** `cn()` resolves Tailwind conflicts (tailwind-merge, taught our tokens in `cn.ts`): a
component's `className` overrides its built-in classes (`<Td className="px-1.5">`, `<Button className="h-14">`).
No `!important` hacks or wrapper divs for that. Add new custom utilities from `tailwind.config.js` to `cn.ts` too.

**Shared hooks** (`hooks/`): `useSquareFit` (largest square that fits: pads, wheels), `useCanvasSize`
(canvas backing store = CSS size × devicePixelRatio, ResizeObserver + DPR changes).

**Layout.** Views fill `<main>` (`h-full flex flex-col`), handle their own scrolling, and must work
from 1024×700 (tablet, sidebar closed) to 1920×1080 touch. No horizontal page scroll; dense grids scroll inside their panel.

**Remote.** The same bundle runs in browsers (`isRemoteMode()`): store actions already forward to
the console; hide console-only features (file dialogs, outputs config) rather than letting them fail.
