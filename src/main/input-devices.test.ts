import { describe, expect, it } from 'vitest'
import { hasKeyInRange, isGameController, parseInputDevices } from './input-devices'

const PROC = `I: Bus=0003 Vendor=045e Product=028e Version=0110
N: Name="Microsoft X-Box 360 pad"
P: Phys=usb-xhci-hcd.1-1/input0
S: Sysfs=/devices/platform/axi/1000120000.pcie/1f00200000.usb/xhci-hcd.1/usb3/3-1/3-1:1.0/input/input7
U: Uniq=
H: Handlers=event5 js0
B: PROP=0
B: EV=20000b
B: KEY=7cdb000000000000 0 0 0 0
B: ABS=3003f

I: Bus=0003 Vendor=0079 Product=0011 Version=0110
N: Name="DragonRise Inc.   Generic   USB  Joystick  "
H: Handlers=event6
B: EV=1b
B: KEY=fff00000000 0 0 0 0
B: ABS=3

I: Bus=0003 Vendor=413c Product=2113 Version=0111
N: Name="Dell KB216 Wired Keyboard"
H: Handlers=sysrq kbd leds event3
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
`

describe('game controller diagnostics', () => {
  const devs = parseInputDevices(PROC)

  it('parses /proc/bus/input/devices', () => {
    expect(devs).toHaveLength(3)
    expect(devs[0]).toMatchObject({ name: 'Microsoft X-Box 360 pad', handlers: ['event5', 'js0'], vendor: '045e' })
  })

  it('recognises pads by their js node or joystick / gamepad buttons, never a keyboard', () => {
    expect(isGameController(devs[0])).toBe(true)
    expect(isGameController(devs[1])).toBe(true) // no js node (joydev missing) but BTN_JOYSTICK bits
    expect(isGameController(devs[2])).toBe(false)
  })

  it('reads key bitmaps word by word', () => {
    expect(hasKeyInRange(['1', '0'], 64, 65)).toBe(true)
    expect(hasKeyInRange(['1', '0'], 0, 64)).toBe(false)
  })
})
