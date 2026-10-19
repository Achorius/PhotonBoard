// PhotonBoard design system — import everything from here:
//   import { Button, Panel, Fader, toast, confirm } from '@renderer/components/ui'
// Guidelines: ./README.md

export { cn } from './cn'
export * from './format'
export { palette, SWATCH_COLORS, tint, withAlpha, prefersDarkText, type Tone } from './tokens'
export { fixtureCategoryIcon, channelTypeIcon, effectCategoryIcon } from './icons'

// Interaction hooks
export { usePointerDrag, type DragState, type PointerDragOptions } from './usePointerDrag'
export { usePress, type PressOptions } from './usePress'
export { hasOpenOverlay } from './overlay'

// Actions
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { IconButton, type IconButtonProps } from './IconButton'
export { ToggleButton, type ToggleButtonProps } from './ToggleButton'
export { SegmentedControl, type SegmentedControlProps, type SegmentedItem } from './SegmentedControl'
export { Tabs, type TabsProps, type TabItem } from './Tabs'
export { contextMenuHandlers, DropdownMenu, Menu, useContextMenu, type MenuEntry, type MenuPoint } from './Menu'

// Structure
export { Panel, PanelHeader, PanelBody, Section } from './Panel'
export { ToolbarGroup, Divider } from './ToolbarGroup'
export { Table, THead, TBody, Tr, Th, Td } from './Table'
export { ListItem, type ListItemProps } from './ListItem'
export { ResizeHandle, useResizable } from './Splitter'
export { EmptyState, type EmptyStateProps } from './EmptyState'

// Display
export { Badge, Tag, type BadgeProps, type TagProps } from './Badge'
export { StatusDot } from './StatusDot'
export { Kbd, formatShortcut } from './Kbd'
export { Tooltip } from './Tooltip'
export { Spinner, Skeleton } from './Spinner'
export { ProgressBar, LevelMeter } from './ProgressBar'
export { ColorSwatch, SwatchPicker } from './ColorSwatch'

// Inputs
export { TextInput, type TextInputProps } from './TextInput'
export { NumberField, type NumberFieldProps } from './NumberField'
export { Select, type SelectOption } from './Select'
export { Switch, Checkbox } from './Switch'
export { Field } from './Field'
export { Slider, type SliderProps } from './Slider'
export { Fader, type FaderProps } from './Fader'
export { Encoder, type EncoderProps } from './Encoder'

// Overlays & feedback
export { Popover, usePopover } from './Popover'
export { Modal, type ModalProps } from './Modal'
export { ConfirmDialog } from './ConfirmDialog'
export { DialogHost, ask, confirm, prompt } from './dialogs'
export { ToastHost } from './Toast'
export { toast, showToast, dismissToast, type ToastType } from '@renderer/stores/toast-store'
export { useDensity, type Density, type DensityPreference } from '@renderer/stores/ui-store'
