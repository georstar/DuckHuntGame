# Duck Hunt

A classic-style Duck Hunt game for the browser. It uses plain HTML5 Canvas and JavaScript, with no dependencies and no build step.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Home screen

- **New game · 1 duck / 2 ducks**: one duck per wave (10 waves) or two at once (5 waves). Either way, a round has 10 ducks.
- **Score history**: your last 100 games with date, mode, difficulty, round reached, accuracy and score, plus overall stats.
- **Settings**: sound on/off, volume, art style (classic vector or pixel art), difficulty (easy/normal/hard), crosshair color, fullscreen.

## How to play

- Aim with the mouse (or tap on touch screens) and click to shoot. You get 3 shots per wave.
- Hit the required number of ducks (blue bar) to advance; it rises in later rounds.
- Black ducks score 500, blue 1000, red 1500, multiplied by the round number. A perfect round (10/10) gives +10000.
- `P` / `Esc` pause (resume, settings, quit) · `M` mute. The game pauses when you switch tabs.

Settings and history are saved in your browser (localStorage).
