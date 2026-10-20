# Command line (`lib/cli`)

grandMA-style command line of PhotonBoard. The same engine serves the
status-bar input, the expanded panel and its touch keypad, macros, remotes
(`cli` web remote command) and MIDI. Keywords are **English in every
language** (console convention); messages, help and the cheat sheet are
translated (`pro.cli.*`, FR/EN).

```ts
import { parse, executeLine, runCommandLine, previewLine, getCliHistory } from '@renderer/lib/cli'
```

## Typing

- Case does not matter: `fixture 1 thru 4 at 50` = `Fixture 1 Thru 4 At 50`.
- A keyword can be shortened to any **unique prefix** (`Fi` = Fixture,
  `Got` = Goto). When the candidates all start with the shortest one, that one
  wins (`Cl` = Clear, not ClearAll). Ambiguous prefixes (`Pa`: Page, Park,
  Pause) are an error that lists the candidates in autocomplete.
- Abbreviations: `F`/`Fix` Fixture · `G` Group · `P` Preset · `C` Cue ·
  `S`/`Seq`/`Scene` Sequence · `E`/`Exec` Executor · `T` Thru · `M` Macro ·
  `Pg` Page · `Ch` Chase · `Fx` Effect · `@` At · `BO` Blackout · `St` Store ·
  `Del` Delete · `Undo` Oops · `Back`/`GoBack` Go- · `Record` Store.
- A keyword can be glued to its number: `F1`, `Group2`.
- Numbers: `5`, `1.5` (cue numbers), dotted ids `4.2` (preset family.number),
  `2.5` (executor page.slot), `1.101` (DMX universe.address).
- Strings: `"Wash"`, `'Wash'`, `“Wash”`, `« Wash »`.
- Options anywhere on the line: `/merge`, `/filter=position,color`.

## Objects and numbers

| Object | Number | Notes |
|---|---|---|
| `Fixture n` | fixture ID (`fid`) | bare numbers are fixtures (`1 Thru 4`) |
| `Group n` | group number | |
| `Preset f.n` | family.number | families 0 All, 1 Dimmer, 2 Position, 3 Gobo, 4 Colour, 5 Beam, 6 Focus, 7 Control; `Preset 2` = `Preset 0.2`, else the only preset numbered 2 |
| `Cue n` | cue number (`1.5`) | of the selected sequence, or `Cue 5 Sequence 2` / `Sequence 2 Cue 5` |
| `Sequence n` | sequence number | alias `Scene` |
| `Executor p.s` | page.slot | slot = col × 4 + row + 1 (column-major, 1-32); `Executor 5` = current page |
| `Page n` | executor page | 1-16 |
| `Macro n`, `Chase n`, `Effect n`, `Speed n` | their number | |
| `DMX u.a` | universe.address | `DMX 101` = universe 1 |

An object without a number answers to its **list position** (1-based), so the
old `Fixture 3` / `Group 2` / `Go 2` keep working on any show.

Lists: `1 Thru 8`, `8 Thru 1` (reverse **order**), `1 Thru` (to the end),
`Thru 5`, `1 + 3 + 5`, `1 Thru 10 - 5`, `Group 2 + Fixture 7`, `Group 2 - 5`.
`>` is accepted for Thru (old syntax). The selection keeps the typed order: it
drives fans and Next / Prev.

## Selection and values

| Line | Effect |
|---|---|
| `Fixture 1 Thru 4` | selects (replaces the selection) |
| `+ 5` · `- Group 2` | adds to / removes from the selection |
| `Fixture 1 Thru 20 If Group 3` | keeps the fixtures also in group 3 (`If` also takes Preset, Cue, Sequence) |
| `If Group 3` | filters the current selection |
| `At 50` · `@ 50` · `Full` · `Zero` | intensity of the **active** fixtures (MAtricks / Next step) |
| `Fixture 1 Thru 4 At 80` · `Group 2 Full` | select and set in one line |
| `At 0 Thru 100` | fan along the selection order (MAtricks phases, align mode) |
| `At 50 Fade 3 Delay 1` | values with their own time (else the programmer time) |
| `At Preset 4.2` · `Fixture 1 Preset 4.2` · `Preset 4.2` · `Call Preset 4.2` | preset on the selection (references kept) |
| `DMX 1.101 At 50` · `DMX 1.1 Thru 1.10 At 0 Thru 100` | raw DMX tester |
| `Gobo 30` · `Color 50` · `Pan 128` … | old command: first channel whose name contains the word, **DMX** value, on the selection (or every fixture) |

Levels are **percent** (Full = 100). A number above 100 is a **DMX** value
0-255 (old rule); `/dmx` makes every number a DMX value (`At 128 /dmx`).
`At Off` = `At Zero` (old). "At" sets the fixture's `Dimmer` / `Intensity`
channel, else its first coarse intensity channel.

## Actions

| Action | Syntax | Notes |
|---|---|---|
| Store | `Store` · `Store Cue 5 [Sequence 3]` · `Store Cue 1 Thru 5` · `Store Sequence 4 ["name"]` · `Store Preset 4.2 [/global\|/universal\|/selective] ["name"]` · `Store Group 5 ["name"]` · `Store Executor 1.3` | `Store` = next cue of the selected sequence (a new sequence when none). An existing cue asks **Merge / Overwrite / Cue only / Cancel** (`CliResult.pending`, `ProApi.ask`); macros merge; an option answers in advance: `/merge /overwrite /remove /cueonly /block`; `/filter=intensity,position,colour,beam,control` |
| Update | `Update [/filter=…]` · `Update Cue 3` · `Update Preset 4.1` | `Update` writes the programmer back to the active cues and the presets the values came from |
| Delete | `Delete Cue 3` · `Delete Sequence 4` · `Delete Preset 4.2` · `Delete Group 3` · `Delete Macro 2` · `Delete Executor 1.5` | never asks: `Oops` restores |
| Copy / Move | `Copy Cue 2 At 5` · `Copy Cue 2 At Cue 5 Sequence 2` · `Copy Preset 4.1 At 4.5` · `Copy Group 1 At 6` · `Copy Macro 1 At 4` · `Copy Sequence 1 At 9` · `Copy Executor 1.1 At 2.1` · `Move Cue 2 At 2.5` · `Move Preset 4.1 At 4.8` · `Move Macro 1 At 7` · `Move Executor 1.1 At 2.1` | an occupied target needs `/overwrite` |
| Label | `Label Group 3 "Wash"` | several objects: "Wash 1", "Wash 2"… (Group, Sequence, Cue, Preset, Macro) |
| Assign | `Assign Sequence 3 At Executor 2.5 [/button=flash]` · `Assign Chase 1 At 1.4` · `Assign Executor 1.5 /button=go` | sources: Sequence, Chase, Effect, Macro, Group, Speed; buttons: toggle go goBack flash temp off select swap pause learn; a destination page that does not exist yet is created (up to 16) |
| Go | `Go` · `Go 3` · `Go Sequence 3` · `Go Executor 2.5` · `Go Macro 2` · `Go Chase 1` · `Go Effect 1` · `Go Cue 3` | no object: the selected sequence (selected executor, else Scenes view), else the first |
| Go- | `Go-` · `Go- 2` · `Go- Executor 1.1` | |
| Goto | `Goto 5` · `Goto Cue 5 Sequence 2` | |
| Off | `Off 3` · `Off Sequence 3` · `Off Executor 1.1` · `Off Macro 3` · `Off Chase 1` · `Off Effect 1` · `Off Group 2` | `Off` alone = selection at zero (old command) |
| Pause | `Pause` · `Pause 2` · `Pause Executor 1.1` | |
| Release | `Release` · `Release Fixture 1 Thru 4` · `Release Sequence 2` | `Release` alone releases everything |
| Stop | `Stop` · `Stop 2` | old command: stops every playing scene / scene 2 |
| Page | `Page 2` · `Page +` · `Page -` | executor page |
| Macro | `Macro 3` | runs it (`Off Macro 3` stops it) |
| Executor | `Executor 2.5` · `Executor 1.1 At 50` · `Select Executor 1.3` | bare = press (its button function); `At` = column fader |
| Sequence / Cue | `Sequence 2` (select) · `Cue 5` (goto) · `Edit Sequence 2` | |
| Chase / Effect / Speed | `Chase 1` (toggle) · `Effect 1` (toggle) · `Speed 1 At 128` (BPM) · `Speed 1` (tap) | |
| Clear | `Clear` · `ClearAll` · `ClearSelection` | Clear in 3 stages: selection, then values, then everything |
| Highlight / Blind / Blackout | `Highlight [On\|Off]` · `Highlight Group 2` · `Blind [On\|Off]` · `Blackout [On\|Off]` | toggles |
| Park / Unpark | `Park` · `Park Fixture 3` · `Park Group 1 At Full` · `Unpark [fixtures]` | Park takes the programmer values (or the level) of the named fixtures or the selection; Unpark: the named fixtures, the selection, else every fixture |
| Fade / Delay | `Fade 3` · `Delay 1.5` · `Fade Off` | programmer time |
| Next / Prev / All / Set | | step through the selection; Set keeps the active fixtures |
| Align | `Align <` · `>` · `<>` · `><` · `Align Off` | fan direction |
| Oops / Redo | | undo / redo the last change |

Every line that changes show content is **one undo step** named after the
line (`ProApi.transaction`), so `Oops` undoes a whole `Store Cue 1 Thru 5`.

## Compatibility with the old command line

Every command the old `CommandLine.tsx` accepted keeps its effect (see the
regression table in `cli.test.ts`): `Clear`, `Blackout`/`BO`, `Go [n]`,
`Stop [n]`, `Group n [At v]`, `Fixture a [Thru|>|+ b…] [At v]`, `At v`/`@ v`,
`Full`, `Zero`, `Off`, `<channel> <0-255>`. Differences, all on purpose:

- `Clear` with a selection first clears the **selection** (grandMA 3 stages);
  a second `Clear` clears the values.
- `Go` (no number) acts on the **selected** sequence when there is one (the
  old one always took the first scene — still the case when none is selected).
- Lines with garbage the old parser ignored (`Off 3`, `Stop 9`) are now read
  (`Off 3` = Sequence 3 off) or reported as errors.
- Fixtures without a dimmer channel still get selected by `Fixture 9 At 50`,
  but the result is a warning instead of "1 fixture at 50%".

## API

- `parse(input)` → `{ ast?, error?, expected }`. Never throws. `expected`
  lists what may come at the end of the input (`kind`: action, object,
  number, value, option, text, end; `values` = keyword chips; `helpKey` =
  `pro.cli.help.<key>`). While a word is being typed (no trailing space) the
  keywords it can still become come first.
- `executeLine(line, ctx?)` → `CliResult`. Never throws. `pending` is set
  when the command asks a question (Store on an existing cue): the immediate
  result says so, `pending` resolves to the final result.
- `runCommandLine(text, origin?, ctx?)` = `executeLine` + `pro-store` log
  (the answer of a question is logged too).
- `previewLine(text, ctx?)` → `"→ 12 fixtures, Group “Wash”, at 50%"`.
- `getCliHistory()` → 200 typed lines, newest first, `localStorage`
  `photonboard.cli.history` (try/catch; recall with draft).
- `runMacro(idOrNumber)`, `stopMacro(id)`, `isMacroRunning(id)`,
  `runningMacros()`, `stopAllMacros()`, `setMacroClock(clock)`.
- `CLI_CHEATSHEET` (+ `pro.cli.cheatsheet.*`) for the syntax card,
  `helpKeyOf(keyword)` for chips.
- `registerCommand(cmd)` adds or replaces a command (keyword + aliases).

### Context and ProApi

Commands only talk to the show through `ProApi` (`lib/pro/contracts.ts`), so
they are tested with `testing/fake-pro-api.ts`. The app wires the real one at
start-up (`lib/pro/setup.ts` installPro: `setCliContext({ api: getProApi(), t,
now: Date.now })`), on the console and on remote browsers. A remote browser
uses it for the preview / autocomplete only: the lines it runs, and the
macros it starts, are sent to the console (`cli`, `run-macro` commands) and
come back in the console's command-line log.

Optional extras the real API may provide:

- `getAlign(): AlignMode | null` — the selection tools' align mode, used by
  fans (without it fans run `<`). The real ProApi provides it.
- `CliContext.macro` is set by the macro runner: questions get their default
  answer (Store merges) and a macro cannot start itself.

### Macros

`macro-runner.ts`: lines run in order; `wait` seconds after a line delay the
next one (a wait on the last line keeps the macro running until it elapses);
a failing line is logged and the macro goes on; `Off Macro n` cancels (also
from inside itself); a running macro never starts again and nesting stops at
8 levels; the clock is injectable.

## Files

`tokenizer.ts` (keywords, tokens) · `parser.ts` (grammar, expectations) ·
`ast.ts` · `objects.ts` (numbers → objects) · `values.ts` (levels, fans,
intensity channel) · `commands/*` (selection, programmer, playback, store,
edit) · `preview.ts` · `help.ts` · `history.ts` · `macro-runner.ts` ·
`registry.ts` · `golden-format.ts` (compact AST text for the golden tests).
