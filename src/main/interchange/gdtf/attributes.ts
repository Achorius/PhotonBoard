// ============================================================
// PhotonBoard — GDTF standard attribute listing (DIN SPEC 15800
// Annex B, from github.com/mvrdevelopment/spec
// gdtf_attributes_with_description.json).
// Row format: Name|Pretty|FeatureGroup.Feature|PhysicalUnit|ActivationGroup|MainAttribute|Color
// "(n)" / "(m)" are index wildcards (Gobo(n) → Gobo1, Gobo2…).
// Pure: used by the GDTF importer (attribute → console channel)
// and exporter (attribute definitions).
// ============================================================

const ROWS: string[] = [
  'Dimmer|Dim|Dimmer.Dimmer',
  'Pan|P|Position.PanTilt|Angle|PanTilt',
  'Tilt|T|Position.PanTilt|Angle|PanTilt',
  'PanRotate|P Rotate|Position.PanTilt|AngularSpeed',
  'TiltRotate|T Rotate|Position.PanTilt|AngularSpeed',
  'PositionEffect|Pos FX|Position.PanTilt',
  'PositionEffectRate|Pos FX Rate|Position.PanTilt',
  'PositionEffectFade|Pos FX Fade|Position.PanTilt',
  'XYZ_X|X|Position.XYZ|Length|XYZ',
  'XYZ_Y|Y|Position.XYZ|Length|XYZ',
  'XYZ_Z|Z|Position.XYZ|Length|XYZ',
  'Rot_X|Rot X|Position.Rotation|Angle|Rot_XYZ',
  'Rot_Y|Rot Y|Position.Rotation|Angle|Rot_XYZ',
  'Rot_Z|Rot Z|Position.Rotation|Angle|Rot_XYZ',
  'Scale_X|Scale X|Position.Scale|Percent|Scale_XYZ',
  'Scale_Y|Scale Y|Position.Scale|Percent|Scale_XYZ',
  'Scale_Z|Scale Z|Position.Scale|Percent|Scale_XYZ',
  'Scale_XYZ|Scale XYZ|Position.Scale|Percent|Scale_XYZ',
  'Gobo(n)|G(n)|Gobo.Gobo||Gobo(n)',
  'Gobo(n)SelectSpin|Select Spin|Gobo.Gobo|AngularSpeed|Gobo(n)|Gobo(n)',
  'Gobo(n)SelectShake|Select Shake|Gobo.Gobo|Frequency|Gobo(n)|Gobo(n)',
  'Gobo(n)SelectEffects|Select Effects|Gobo.Gobo||Gobo(n)|Gobo(n)',
  'Gobo(n)WheelIndex|Wheel Index|Gobo.Gobo|Angle|Gobo(n)|Gobo(n)',
  'Gobo(n)WheelSpin|Wheel Spin|Gobo.Gobo|AngularSpeed|Gobo(n)|Gobo(n)',
  'Gobo(n)WheelShake|Wheel Shake|Gobo.Gobo|Frequency|Gobo(n)|Gobo(n)',
  'Gobo(n)WheelRandom|Wheel Random|Gobo.Gobo|Frequency|Gobo(n)|Gobo(n)',
  'Gobo(n)WheelAudio|Wheel Audio|Gobo.Gobo||Gobo(n)|Gobo(n)',
  'Gobo(n)Pos|G(n) <>|Gobo.Gobo|Angle|Gobo(n)Pos',
  'Gobo(n)PosRotate|Rotate|Gobo.Gobo|AngularSpeed|Gobo(n)Pos|Gobo(n)Pos',
  'Gobo(n)PosShake|Shake|Gobo.Gobo|Frequency|Gobo(n)Pos|Gobo(n)Pos',
  'AnimationWheel(n)|Anim(n)|Gobo.Gobo||AnimationWheel(n)',
  'AnimationWheel(n)Audio|Anim Audio|Gobo.Gobo||AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)Macro|Anim FX|Gobo.Gobo||AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)Random|Anim Random|Gobo.Gobo|Frequency|AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)SelectEffects|Anim Select FX|Gobo.Gobo||AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)SelectShake|Anim Select Shake|Gobo.Gobo|Frequency|AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)SelectSpin|Anim Select Spin|Gobo.Gobo|AngularSpeed|AnimationWheel(n)|AnimationWheel(n)',
  'AnimationWheel(n)Pos|Anim Pos|Gobo.Gobo|Angle|AnimationWheel(n)Pos',
  'AnimationWheel(n)PosRotate|Anim Rotate|Gobo.Gobo|AngularSpeed|AnimationWheel(n)Pos|AnimationWheel(n)Pos',
  'AnimationWheel(n)PosShake|Anim Shake|Gobo.Gobo|Frequency|AnimationWheel(n)Pos|AnimationWheel(n)Pos',
  'AnimationSystem(n)|Anim System|Gobo.Gobo|Percent|AnimationSystem(n)',
  'AnimationSystem(n)Ramp|Anim System Ramp|Gobo.Gobo|Frequency|AnimationSystem(n)|AnimationSystem(n)',
  'AnimationSystem(n)Shake|Anim System Shake|Gobo.Gobo|Frequency|AnimationSystem(n)|AnimationSystem(n)',
  'AnimationSystem(n)Audio|Anim System Audio|Gobo.Gobo|None|AnimationSystem(n)|AnimationSystem(n)',
  'AnimationSystem(n)Random|Anim System Random|Gobo.Gobo|None|AnimationSystem(n)|AnimationSystem(n)',
  'AnimationSystem(n)Pos|Anim System Pos|Gobo.Gobo|Angle|AnimationSystem(n)Pos',
  'AnimationSystem(n)PosRotate|Anim System Rotate|Gobo.Gobo|AngularSpeed|AnimationSystem(n)Pos|AnimationSystem(n)Pos',
  'AnimationSystem(n)PosShake|Anim System Shake|Gobo.Gobo|Frequency|AnimationSystem(n)Pos|AnimationSystem(n)Pos',
  'AnimationSystem(n)PosRandom|Anim System Rot Random|Gobo.Gobo|None|AnimationSystem(n)Pos|AnimationSystem(n)Pos',
  'AnimationSystem(n)PosAudio|Anim System Rot Audio|Gobo.Gobo|None|AnimationSystem(n)Pos|AnimationSystem(n)Pos',
  'AnimationSystem(n)Macro|Anim System Macro|Gobo.Gobo|None',
  'MediaFolder(n)|Media Folder(n)|Gobo.Media',
  'MediaContent(n)|Media Content(n)|Gobo.Media',
  'ModelFolder(n)|Model Folder(n)|Gobo.Media|None',
  'ModelContent(n)|Model Content(n)|Gobo.Media|None',
  'Playmode|Playmode|Gobo.Media',
  'PlayBegin|Play Begin|Gobo.Media|Time',
  'PlayEnd|Play End|Gobo.Media|Time',
  'PlaySpeed|Play Speed|Gobo.Media|Percent',
  'ColorEffects(n)|Color FX(n)|Color.Color',
  'Color(n)|C(n)|Color.Color||ColorRGB',
  'Color(n)WheelIndex|Wheel Index|Color.Color|Angle|ColorRGB|Color(n)',
  'Color(n)WheelSpin|Wheel Spin|Color.Color|AngularSpeed|ColorRGB|Color(n)',
  'Color(n)WheelRandom|Wheel Random|Color.Color|Frequency|ColorRGB|Color(n)',
  'Color(n)WheelAudio|Wheel Audio|Color.Color||ColorRGB|Color(n)',
  'ColorAdd_R|R|Color.RGB|ColorComponent|ColorRGB||0.64,0.33,21.3',
  'ColorAdd_G|G|Color.RGB|ColorComponent|ColorRGB||0.3,0.6,71.5',
  'ColorAdd_B|B|Color.RGB|ColorComponent|ColorRGB||0.15,0.06,7.2',
  'ColorAdd_C|C|Color.RGB|ColorComponent|ColorRGB||0.225,0.329,78.7',
  'ColorAdd_M|M|Color.RGB|ColorComponent|ColorRGB||0.321,0.154,28.5',
  'ColorAdd_Y|Y|Color.RGB|ColorComponent|ColorRGB||0.419,0.505,92.8',
  'ColorAdd_RY|Amber|Color.RGB|ColorComponent|ColorRGB||0.477,0.460,57.0',
  'ColorAdd_GY|Lime|Color.RGB|ColorComponent|ColorRGB||0.372,0.543,82.1',
  'ColorAdd_GC|Blue-Green|Color.RGB|ColorComponent|ColorRGB||0.250,0.419,75.1',
  'ColorAdd_BC|Light-Blue|Color.RGB|ColorComponent|ColorRGB||0.200,0.239,43.0',
  'ColorAdd_BM|Purple|Color.RGB|ColorComponent|ColorRGB||0.254,0.117,17.9',
  'ColorAdd_RM|Pink|Color.RGB|ColorComponent|ColorRGB||0.403,0.200,24.9',
  'ColorAdd_W|White|Color.RGB|ColorComponent|ColorRGB||0.313,0.329,100.0',
  'ColorAdd_WW|WW|Color.RGB|ColorComponent|ColorRGB||0.319,0.340,99.3',
  'ColorAdd_CW|CW|Color.RGB|ColorComponent|ColorRGB||0.306,0.329,97.9',
  'ColorAdd_UV|UV|Color.RGB|ColorComponent|ColorRGB||0.176,0.005,0.6',
  'ColorSub_R|R|Color.RGB|ColorComponent|ColorRGB||0.64,0.33,21.3',
  'ColorSub_G|G|Color.RGB|ColorComponent|ColorRGB||0.3,0.6,71.5',
  'ColorSub_B|B|Color.RGB|ColorComponent|ColorRGB||0.15,0.06,7.2',
  'ColorSub_C|C|Color.RGB|ColorComponent|ColorRGB||0.225,0.329,78.7',
  'ColorSub_M|M|Color.RGB|ColorComponent|ColorRGB||0.321,0.154,28.5',
  'ColorSub_Y|Y|Color.RGB|ColorComponent|ColorRGB||0.419,0.505,92.8',
  'ColorMacro(n)|Color Macro(n)|Color.RGB',
  'ColorMacro(n)Rate|Color Macro(n) Rate|Color.RGB',
  'CTO|CTO|Color.Color|Temperature',
  'CTC|CTC|Color.Color|Temperature',
  'CTB|CTB|Color.Color|Temperature',
  'Tint|Tint|Color.Color',
  'HSB_Hue|H|Color.HSB|Angle|ColorHSB',
  'HSB_Saturation|S|Color.HSB|Percent|ColorHSB',
  'HSB_Brightness|B|Color.HSB|Percent|ColorHSB',
  'HSB_Quality|Q|Color.HSB|Percent|ColorHSB',
  'CIE_X|X|Color.CIE||ColorCIE',
  'CIE_Y|Y|Color.CIE||ColorCIE',
  'CIE_Brightness|B|Color.CIE|Percent|ColorCIE',
  'ColorRGB_Red|R|Color.Indirect||ColorIndirect',
  'ColorRGB_Green|G|Color.Indirect||ColorIndirect',
  'ColorRGB_Blue|B|Color.Indirect||ColorIndirect',
  'ColorRGB_Cyan|C|Color.Indirect||ColorIndirect',
  'ColorRGB_Magenta|M|Color.Indirect||ColorIndirect',
  'ColorRGB_Yellow|Y|Color.Indirect||ColorIndirect',
  'ColorRGB_Quality|Q|Color.Indirect||ColorIndirect',
  'VideoBoost_R|Boost R|Color.ColorCorrection|None|||0.64,0.33,21.3',
  'VideoBoost_G|Boost G|Color.ColorCorrection|None|||0.3,0.6,71.5',
  'VideoBoost_B|Boost B|Color.ColorCorrection|None|||0.15,0.06,7.2',
  'VideoHueShift|Hue Shift|Color.HSBC_Shift|Angle',
  'VideoSaturation|S|Color.HSBC_Shift|Percent',
  'VideoBrightness|B|Color.HSBC_Shift|Percent',
  'VideoContrast|C|Color.HSBC_Shift|Percent',
  'VideoKeyColor_R|R|Color.ColorKey|None|||0.64,0.33,21.3',
  'VideoKeyColor_G|G|Color.ColorKey|None|||0.3,0.6,71.5',
  'VideoColorKey_B|B|Color.ColorKey|None|||0.15,0.06,7.2',
  'VideoKeyIntensity|Intensity|Color.ColorKey|Percent',
  'VideoKeyTolerance|Tolerance|Color.ColorKey|None',
  'StrobeDuration|Strobe Duration|Beam.Beam|Time',
  'StrobeRate|Strobe Rate|Beam.Beam',
  'StrobeFrequency|Strobe Frequency|Beam.Beam|Frequency',
  'StrobeModeShutter|StrobeM Shutter|Beam.Beam',
  'StrobeModeStrobe|StrobeM Strobe|Beam.Beam|||StrobeModeShutter',
  'StrobeModePulse|StrobeM Pulse|Beam.Beam|||StrobeModeShutter',
  'StrobeModePulseOpen|StrobeM PulseOpen|Beam.Beam|||StrobeModeShutter',
  'StrobeModePulseClose|StrobeM Pulse Close|Beam.Beam|||StrobeModeShutter',
  'StrobeModeRandom|StrobeM Random|Beam.Beam|||StrobeModeShutter',
  'StrobeModeRandomPulse|StrobeM Random Pulse|Beam.Beam|||StrobeModeShutter',
  'StrobeModeRandomPulseOpen|StrobeM Random Pulse Open|Beam.Beam|||StrobeModeShutter',
  'StrobeModeRandomPulseClose|StrobeM Random Pulse Close|Beam.Beam|||StrobeModeShutter',
  'StrobeModeEffect|StrobeM Effect|Beam.Beam|||StrobeModeShutter',
  'Shutter(n)|Sh(n)|Beam.Beam',
  'Shutter(n)Strobe|Strobe(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobePulse|Pulse(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobePulseClose|Pulse Close(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobePulseOpen|Pulse Open(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobeRandom|Random(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobeRandomPulse|Random Pulse(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobeRandomPulseClose|Random Pulse Close(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobeRandomPulseOpen|Random Pulse Open(n)|Beam.Beam|Frequency||Shutter(n)',
  'Shutter(n)StrobeEffect|Effect(n)|Beam.Beam|Frequency||Shutter(n)',
  'Iris|Iris|Beam.Beam',
  'IrisStrobe|Strobe|Beam.Beam|Frequency||Iris',
  'IrisStrobeRandom|Random Strobe|Beam.Beam|Frequency||Iris',
  'IrisPulseClose|Pulse Close|Beam.Beam|Frequency||Iris',
  'IrisPulseOpen|Pulse Open|Beam.Beam|Frequency||Iris',
  'IrisRandomPulseClose|Random Pulse Close|Beam.Beam|Frequency||Iris',
  'IrisRandomPulseOpen|Random Pulse Open|Beam.Beam|Frequency||Iris',
  'Frost(n)|Frost(n)|Beam.Beam',
  'Frost(n)PulseOpen|Pulse Open (n)|Beam.Beam|Frequency||Frost(n)',
  'Frost(n)PulseClose|Pulse Close (n)|Beam.Beam|Frequency||Frost(n)',
  'Frost(n)Ramp|Ramp (n)|Beam.Beam|Frequency||Frost(n)',
  'Prism(n)|Prism(n)|Beam.Beam||Prism',
  'Prism(n)SelectSpin|Select Spin(n)|Beam.Beam|AngularSpeed|Prism|Prism(n)',
  'Prism(n)Macro|Prism(n) Macro|Beam.Beam||Prism|Prism(n)',
  'Prism(n)Pos|Prism(n) Pos|Beam.Beam|AngularSpeed',
  'Prism(n)PosRotate|Rotate(n)|Beam.Beam|AngularSpeed|Prism|Prism(n)Pos',
  'Effects(n)|FX(n)|Beam.Beam',
  'Effects(n)Rate|FX(n) Rate|Beam.Beam|Frequency',
  'Effects(n)Fade|FX(n) Fade|Beam.Beam',
  'Effects(n)Adjust(m)|FX(n) Adjust(m)|Beam.Beam',
  'Effects(n)Pos|FX(n) Pos|Beam.Beam|Angle',
  'Effects(n)PosRotate|FX(n) Rotate|Beam.Beam|AngularSpeed||Effects(n)Pos',
  'EffectsSync|FX Sync|Beam.Beam',
  'BeamShaper|Beam Shaper|Beam.Beam||BeamShaper',
  'BeamShaperMacro|Beam Shaper Macro|Beam.Beam||BeamShaper',
  'BeamShaperPos|Beam Shaper <>|Beam.Beam|Angle|BeamShaper',
  'BeamShaperPosRotate|Beam Shaper Rotate|Beam.Beam|AngularSpeed|BeamShaper',
  'Zoom|Zoom|Focus.Focus|Angle',
  'ZoomModeSpot|Zoom Spot|Focus.Focus|Angle',
  'ZoomModeBeam|Zoom Beam|Focus.Focus|Angle',
  'DigitalZoom|DZoom|Focus.Focus|Angle',
  'Focus(n)|Focus(n)|Focus.Focus',
  'Focus(n)Adjust|Focus(n) Adjust|Focus.Focus',
  'Focus(n)Distance|Focus(n) Distance|Focus.Focus|Length',
  'Control(n)|Ctrl(n)|Control.Control',
  'DimmerMode|Dim Mode|Control.Control',
  'DimmerCurve|Dim Curve|Control.Control',
  'BlackoutMode|Blackout Mode|Control.Control',
  'LEDFrequency|LED Frequency|Control.Control|Frequency',
  'LEDZoneMode|LED Zone Mode|Control.Control',
  'PixelMode|Pixel Mode|Control.Control',
  'PanMode|Pan Mode|Control.Control',
  'TiltMode|Tilt Mode|Control.Control',
  'PanTiltMode|PanTilt Mode|Control.Control',
  'PositionModes|Pos Modes|Control.Control',
  'Gobo(n)WheelMode|G(n) Mode|Control.Control',
  'GoboWheelShortcutMode|Gobo Shortcut Mode|Control.Control',
  'AnimationWheel(n)Mode|Anim Mode|Control.Control',
  'AnimationWheelShortcutMode|Anim Shortcut Mode|Control.Control',
  'Color(n)Mode|C(n) Mode|Control.Control',
  'ColorWheelShortcutMode|Color Wheel Shortcut Mode|Control.Control',
  'CyanMode|Cyan Mode|Control.Control',
  'MagentaMode|Magenta Mode|Control.Control',
  'YellowMode|Yellow Mode|Control.Control',
  'ColorMixMode|Color Mix Mode|Control.Control',
  'ChromaticMode|Chroma Mode|Control.Control',
  'ColorCalibrationMode|CCalib Mode|Control.Control',
  'ColorConsistency|Color consistency|Control.Control',
  'ColorControl|Color Ctrl|Control.Control',
  'ColorModelMode|ColorModel|Control.Control',
  'ColorSettingsReset|Color Ctrl Rst|Control.Control',
  'ColorUniformity|ColorUniform|Control.Control',
  'CRIMode|CRI Mode|Control.Control',
  'CustomColor|Custom Color|Control.Control',
  'UVStability|UV Stab|Control.Control',
  'WaveLengthCorrection|WaveLength|Control.Control',
  'WhiteCount|White Count|Control.Control',
  'StrobeMode|Strobe Mode|Control.Control',
  'ZoomMode|Zoom Mode|Control.Control',
  'FocusMode|Focus Mode|Control.Control',
  'IrisMode|Iris Mode|Control.Control',
  'FanMode|Fan Mode|Control.Control',
  'FollowSpotMode|FollowSpot Mode|Control.Control',
  'BeamEffectIndexRotateMode|Beam Effect Index Rotate Mode|Control.Control',
  'IntensityMSpeed|Intensity MSpeed|Control.Control',
  'PositionMSpeed|Pos MSpeed|Control.Control',
  'ColorMixMSpeed|Color Mix MSpeed|Control.Control',
  'ColorWheelSelectMSpeed|Color Wheel Select MSpeed|Control.Control',
  'GoboWheel(n)MSpeed|Gobo Wheel(n) MSpeed|Control.Control',
  'IrisMSpeed|Iris MSpeed|Control.Control',
  'Prism(n)MSpeed|Prism(n) MSpeed|Control.Control',
  'FocusMSpeed|Focus MSpeed|Control.Control',
  'Frost(n)MSpeed|Frost(n) MSpeed|Control.Control',
  'ZoomMSpeed|Zoom MSpeed|Control.Control',
  'FrameMSpeed|Frame MSpeed|Control.Control',
  'GlobalMSpeed|Global MSpeed|Control.Control',
  'ReflectorAdjust|Reflector Adj|Control.Control',
  'FixtureGlobalReset|Fixture Global Reset|Control.Control',
  'DimmerReset|Dimmer Reset|Control.Control',
  'ShutterReset|Shutter Reset|Control.Control',
  'BeamReset|Beam Reset|Control.Control',
  'ColorMixReset|Color Mix Reset|Control.Control',
  'ColorWheelReset|Color Wheel Reset|Control.Control',
  'FocusReset|Focus Reset|Control.Control',
  'FrameReset|Frame Reset|Control.Control',
  'GoboWheelReset|G Reset|Control.Control',
  'IntensityReset|Intensity Reset|Control.Control',
  'IrisReset|Iris Reset|Control.Control',
  'PositionReset|Pos Reset|Control.Control',
  'PanReset|Pan Reset|Control.Control',
  'TiltReset|Tilt Reset|Control.Control',
  'ZoomReset|Zoom Reset|Control.Control',
  'CTBReset|CTB Reset|Control.Control',
  'CTOReset|CTO Reset|Control.Control',
  'CTCReset|CTC Reset|Control.Control',
  'AnimationSystemReset|Anim Sytem Reset|Control.Control',
  'FixtureCalibrationReset|Fixture Calibration Reset|Control.Control',
  'Function|Function|Control.Control',
  'LampControl|Lamp Ctrl|Control.Control',
  'DisplayIntensity|Display Int|Control.Control',
  'DMXInput|DMX Input|Control.Control',
  'NoFeature|NoFeature|Control.Control',
  'Dummy|Dummy|Control.Control',
  'Blower(n)|Blower(n)|Control.Control',
  'Fan(n)|Fan(n)|Control.Control',
  'Fog(n)|Fog(n)|Control.Control',
  'Haze(n)|Haze(n)|Control.Control',
  'LampPowerMode|Lamp Power Mode|Control.Control',
  'Fans|Fans|Control.Control',
  'Blade(n)A|Blade(n)A|Shapers.Shapers||Shaper',
  'Blade(n)B|Blade(n)B|Shapers.Shapers||Shaper',
  'Blade(n)Rot|Blade(n) Rot|Shapers.Shapers|Angle|Shaper',
  'ShaperRot|Shaper Rot|Shapers.Shapers|Angle|Shaper',
  'ShaperMacros|Shaper Macros|Shapers.Shapers',
  'ShaperMacrosSpeed|Shaper Macros Speed|Shapers.Shapers',
  'BladeSoft(n)A|BladeS(n)A|Shapers.Shapers|None',
  'BladeSoft(n)B|BladeS(n)B|Shapers.Shapers|None',
  'KeyStone(n)A|KS(n)A|Shapers.Shapers|None',
  'KeyStone(n)B|KS(n)B|Shapers.Shapers|None',
  'Video|Video|Video.Video',
  'VideoEffect(n)Type|Video Effect(n) Type|Video.Video',
  'VideoEffect(n)Parameter(m)|Video Effect(n) Parameter(m)|Video.Video',
  'VideoCamera(n)|Video Camera(n)|Video.Video',
  'FieldOfView|FOV|Video.Video|Angle',
  'InputSource|ISrc|Video.Video|None',
  'VideoBlendMode|BlendMode|Video.Video|None',
  'VideoSoundVolume(n)|Volume(n)|Video.Video|Percent'
]

export interface GdtfAttributeDef {
  /** Concrete name (wildcards resolved): "Gobo2Pos" */
  name: string
  pretty: string
  /** "Gobo.Gobo" */
  feature: string
  physicalUnit?: string
  activationGroup?: string
  mainAttribute?: string
  /** CIE xyY "x,y,Y" */
  color?: string
  /** Pattern it came from ("Gobo(n)Pos"); undefined for custom attributes */
  pattern?: string
  /** Wildcard values (n, m) */
  n?: number
  m?: number
}

interface Pattern {
  pattern: string
  regex: RegExp
  fields: string[]
}

let compiled: Pattern[] | null = null

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compile(): Pattern[] {
  if (compiled) return compiled
  compiled = ROWS.map((row) => {
    const fields = row.split('|')
    const pattern = fields[0]
    const src = pattern.split(/\((?:n|m)\)/).map(escapeRegex).join('(\\d+)')
    return { pattern, regex: new RegExp(`^${src}$`), fields }
  })
  return compiled
}

function fill(text: string | undefined, n?: number, m?: number): string | undefined {
  if (!text) return undefined
  return text.replace(/\(n\)/g, n !== undefined ? String(n) : '').replace(/\(m\)/g, m !== undefined ? String(m) : '')
}

/** Standard definition of an attribute name ("Gobo2Pos", "ColorAdd_R"), or null for a custom attribute */
export function lookupGdtfAttribute(name: string): GdtfAttributeDef | null {
  for (const p of compile()) {
    const match = p.regex.exec(name)
    if (!match) continue
    const n = match[1] !== undefined ? parseInt(match[1], 10) : undefined
    const m = match[2] !== undefined ? parseInt(match[2], 10) : undefined
    const [, pretty, feature, unit, group, main, color] = p.fields
    return {
      name,
      pretty: fill(pretty, n, m) ?? name,
      feature,
      physicalUnit: unit || undefined,
      activationGroup: fill(group, n, m),
      mainAttribute: fill(main, n, m),
      color: color || undefined,
      pattern: p.pattern,
      n,
      m
    }
  }
  return null
}

/** Pretty names of the standard feature groups */
export const FEATURE_GROUP_PRETTY: Record<string, string> = {
  Dimmer: 'Dimmer',
  Position: 'Position',
  Gobo: 'Gobo',
  Color: 'Color',
  Beam: 'Beam',
  Focus: 'Focus',
  Control: 'Control',
  Shapers: 'Shapers',
  Video: 'Video'
}
