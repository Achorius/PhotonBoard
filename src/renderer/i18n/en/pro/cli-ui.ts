// Command line UI (pro.cliUi.*): expand button, docked panel (log,
// autocomplete chips, preview), touch keypad. Keywords on the keys
// (Fixture, At, Store…) are never translated.

export const cliUi = {
  expand: 'Open the command panel',
  collapse: 'Close the command panel',
  panelTitle: 'Command line',
  panelAria: 'Command line panel',
  keypad: 'Keypad',
  keypadShow: 'Show the keypad',
  keypadHide: 'Hide the keypad',
  keypadAria: 'Command keypad',
  clearLog: 'Clear the log',
  logAria: 'Command log',
  logEmptyTitle: 'No commands yet',
  logEmptyText: 'Type a command or use the keypad, e.g. Fixture 1 Thru 4 At 80, then Please.',
  recallTitle: 'Put this command back on the line',
  origin: {
    console: 'Console',
    macro: 'Macro',
    remote: 'Remote'
  },
  /** Next-word hints when the parser expects something without a fixed list */
  expect: {
    title: 'Next',
    action: 'a command',
    object: 'an object',
    number: 'a number',
    value: 'a value',
    option: 'an option',
    text: 'a name in quotes',
    end: 'Please (Enter) runs it'
  },
  chipsAria: 'Suggestions',
  syntaxError: 'Check the command near “{token}”',
  syntaxErrorEnd: 'The command is not complete',
  legacyNote: 'Basic commands (full syntax coming)',
  backspace: 'Delete the last character',
  please: 'Please',
  pleaseTitle: 'Run the command (Enter)'
}
