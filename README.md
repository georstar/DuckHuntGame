# Duck Hunt

A classic-style Duck Hunt game for the browser. It uses plain HTML5 Canvas and JavaScript, with no dependencies and no build step.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How to play

- Aim with the mouse (or tap on touch screens) and click to shoot.
- You get 3 shots per duck. Each round has 10 ducks.
- Hit the required number of ducks (blue bar) to advance; it rises in later rounds.
- Black ducks score 500, blue 1000, red 1500, multiplied by the round number. A perfect round (10/10) gives a +10000 bonus.
- `P` / `Esc` pause · `M` mute.

The high score is saved in your browser.
