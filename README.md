# Digital Pet

An illustrated cat that lives on your macOS desktop, chain-smoking and is always unimpressed by
you. She really is a digital representation of an orange cat if she was a sailor. She wanders along the top of the Dock, naps, grooms, watches your cursor,
and can be picked up and thrown. Her body stays in profile while her face turns
toward you. If Ollama is running, she talks back — with a local model, so
nothing leaves your machine.

Built with Electron. No sprite sheets, no runtime dependencies: every frame is
drawn as vector canvas paths, so she's crisp at any size on Retina.

## Quick start

```
npm install
npm start
```

Requires macOS and Node.js. Quit from the cat icon in the menu bar.

To install her as a standalone app in `~/Applications`:

```
npm run build:app
```

Other scripts:

```
npm run preview      # render every pose to preview.png to check the art
npm run icon         # redraw Resources/icon.png from her own art
```

## Making her talk

She insults you, in a speech bubble, using a local model through
[Ollama](https://ollama.com). Being an orange cat, she has one brain cell and
unlimited confidence.

Requirements: Ollama running (`ollama serve`) with a model pulled. Default is
`llama3.2:3b`, which is fast enough to feel instant and holds the character
well — `qwen2.5:3b` was tested and rambles incoherently. Switch models from the
menu bar, or set them up front:

```
PET_MODEL=llama3.1:8b npm start
OLLAMA_HOST=http://127.0.0.1:11434 npm start
```

**Nothing leaves your machine.** `src/voice.js` runs in the main process and
talks only to localhost. If Ollama is not running she falls back to canned
lines, so she is never mute — just less creative. Turn talking off entirely
with "Talks back" in the menu bar.

**When she speaks.** Being petted, picked up, thrown, startled, waking from a
nap, being summoned, and at random every 30–70s (with a distinct "you have not
moved in a while" line if you have gone quiet). Every remark is a dice roll, and
a 20-second cooldown (`TALK_GAP` in `src/renderer/pet.js`) stops her from
becoming noise. "Say something" in the menu bar ignores the cooldown.

**Unpredictability** is deliberate: temperature wanders between 1.0 and 1.35
per call, a random mood and an optional topic are injected into each prompt,
and the last 8 lines are remembered and rejected as duplicates.

**Profanity quota.** Asking the model to swear is not the same as it swearing —
it complies maybe two thirds of the time, so aiming at 50% realises well under
half. Instead the output is checked against a profanity pattern and the result
recorded in a rolling window of the last 12 lines. Whenever the *realised* rate
drops below `TARGET_RATE` (0.72), the next call is forced: it asks for a swear,
retries up to three times escalating from "Swear in this one" to a blunt
demand, and if the model still refuses it falls back to a canned profane line.
Measured output sits around 70%. Lower `TARGET_RATE` in `src/voice.js` to tone
her down; set it to 0 and she only swears when the mood takes her.

To retune her personality, edit `PERSONA` in `src/voice.js` — the few-shot
example lines shape the voice far more than the adjectives do. She is told to
mock what you do (typing, code, posture, snacks, bedtime) and never to comment
on appearance, identity, or anything a person cannot change.

## What she does

**On her own.** Wanders, stands, sits, grooms, loafs, curls up and sleeps, and
stretches on waking. An `energy` value drains while she's active and recovers
while she's curled up, which reweights what she's likely to do next — so she
naps more as the hour goes on. It persists across restarts.

**With your cursor.** Her pupils track it continuously, easing rather than
snapping. A fast swipe close to her makes her startle and hop back (with a
cooldown, so it isn't constant). Otherwise she gets curious every few seconds,
stalks over with her tail low, then sits and watches it. Move away and she
follows.

**With your hands.** Click her to pet her — she shuts her eyes, purrs hearts
and gains a little energy. Drag her anywhere and let go: she falls under
gravity, bounces once if thrown hard, wall-bounces off the screen edges, and
shakes it off on landing.

**Menu bar.** Come here · Go to sleep · Say something · Wander around (off =
she stays put) · Talks back · Voice model · Size (small/medium/large) · Quit.

## Her look

Two palettes live in `src/renderer/art/cat.js`; `var C = PALETTES.noir` picks
one. `noir` is the black cat with red eyes; `tabby` is the original orange.
Switching is a one-line change — everything downstream reads from `C`.

The noir fur is charcoal, never true black: a pure-black cat loses all interior
form and reads as a featureless silhouette. The gradient from `FUR_LIT` to
`FUR_DEEP` is what keeps her body legible, and her whiskers switch to a cool
light grey, since the warm brown ones vanish against dark fur.

Her expression is three things working together, and all three matter — drop
any one and she drifts back to looking pleased with herself:

- The mouth corners fall *below* centre. Curving them back up is a smile.
- Closed eyes are flat, faintly downturned lids. An upward ∪ arc reads as glee.
- Heavy upper lids plus flat brows. Lids alone read as sleepy; the brows tip it
  into unimpressed. Angling the inner ends down further makes her look furious
  rather than indifferent.

The cigarette is drawn in head-local coordinates, so it inherits her head tilt
and mirrors automatically when she turns around. `art.cigTip()` reports where
the ember is, and the renderer hangs drifting smoke particles off it. She puts
it out while asleep.

## How it works

```
src/main.js              transparent always-on-top window, tray menu, cursor polling
src/preload.js           IPC bridge
src/voice.js             Ollama client, persona, profanity quota (main process)
src/renderer/pet.js      behaviour engine — state machine, gait, cursor reactions, drag physics
src/renderer/art/cat.js  vector renderer: every pose as canvas paths
Scripts/build_app.sh     hand-rolled .app bundler
tools/                   pose preview and icon rasteriser
```

There is no sprite sheet on disk. `src/renderer/art/cat.js` draws every frame
as anti-aliased canvas paths in a fixed 180×152 design space — ellipses,
rounded capsule limbs, a tapered bezier tail with clipped rings, stripes clipped
to the body, and a soft fur gradient. Because it's vector, she's rasterised
straight at your display's device pixels at any size instead of being scaled up
from a low-resolution grid, so nothing looks blocky on Retina.

Silhouettes use a two-pass trick: within a group every path is stroked with the
outline colour first, then all of them are filled. Later fills cover the
interior strokes, leaving one clean outline around the whole group rather than
seams where parts overlap — which is also why her legs read as attached to her
body instead of hanging off it.

`src/main.js` owns a single transparent, always-on-top window covering the
primary display. It stays click-through: the renderer publishes the cat's
hitbox, the main process polls the global cursor at 30 Hz, and mouse events are
enabled *only* while the pointer is actually over her. The window is
`focusable: false`, so petting her never steals focus from what you're typing
in.

**Walk cycle.** The gait is driven by distance travelled, not by time — `phase`
advances by `distance / (STRIDE * SCALE)` — so her paws never slide against the
floor regardless of speed or size. The four legs run a diagonal gait, a quarter
cycle apart, with the far pair drawn in a shadowed palette entry for depth.

## Building the app

`npm run build:app` produces `~/Applications/Tabby.app`, launchable from
Finder, Spotlight or the Dock. To have her show up at login: System Settings →
General → Login Items → add Tabby.

The bundle is hand-rolled rather than built with electron-builder, because the
app has no runtime dependencies — every module it uses is either an Electron
built-in or Node's own. So `Scripts/build_app.sh` copies the Electron runtime
out of `node_modules`, drops `package.json` + `src/` into
`Contents/Resources/app`, writes an `Info.plist`, and re-signs. No extra
tooling, no download, ~275MB (almost entirely Electron itself).

Three details in that script that are load-bearing:

- **`LSUIElement`** is true, so she is menu-bar only and never takes a Dock
  slot.
- **`default_app.asar` is deleted.** Leave it and Electron may boot its own
  demo app instead of yours.
- **Staged in `/tmp`, installed to `~/Applications`.** Anything under
  `~/Desktop` or `~/Documents` can sit in an iCloud file-provider domain, which
  stamps `com.apple.FinderInfo` onto a `.app` at unpredictable times — well
  after signing — and that breaks the seal. Signing somewhere never synced,
  then `ditto --noextattr --norsrc --noqtn` into place, avoids it. The script
  fails loudly if `codesign --verify --strict` does not pass.

Editing Electron.app's contents invalidates its original signature, so the
whole tree is re-signed (`--deep`, ad-hoc by default). If you ever want a
stable identity across rebuilds, create one named `Tabby Dev` and the script
picks it up automatically.

The app icon is drawn by the cat's own vector renderer — `tools/icon.html`
poses her sitting on a teal plate (complementary to her orange, so she still
reads at 32px in a Finder list) and `npm run icon` rasterises it to 1024px,
which `build_app.sh` turns into a full `.icns` set.

## Known limits

- macOS only (relies on the menu bar, Dock work area and `.app` bundling).
- Primary display only; she won't walk onto a second monitor.
- Her floor is the bottom of the work area (top of the Dock). She doesn't
  climb onto window edges.

## License

ISC
