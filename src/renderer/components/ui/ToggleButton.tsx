import { Button, type ButtonProps } from './Button'

export interface ToggleButtonProps extends Omit<ButtonProps, 'active' | 'onClick' | 'onPress' | 'onRelease'> {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}

/** Latching on/off button (aria-pressed). Active colour = `tone`. */
export function ToggleButton({ pressed, onPressedChange, ...rest }: ToggleButtonProps) {
  return <Button {...rest} active={pressed} onClick={() => onPressedChange(!pressed)} />
}
