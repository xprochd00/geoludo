# 🌍 GeoLudo — The World Race

A geography and history board game inspired by Ludo. Roll the die, pick a piece, then answer by clicking the right country on an interactive world map to move it forward.

## Play

There's nothing to install or build. Either:

- open `index.html` in a browser, or
- serve the folder, e.g. `python3 -m http.server` and open <http://localhost:8000>.

## Rules

- 2–4 players take turns on one computer (hot seat). Each player picks how many pieces (1–4) they race with. All pieces start in the home yard.
- **Leaving home:** a piece can only come out on a **6**. Bringing a piece out needs no question.
- **Choosing a piece:** after every roll, the pieces that can move glow. Click the one you want, or press its number key. A piece is never picked for you. On a 6 you can either bring out a new piece or move one already on the board.
- **Moving:** moving a piece on the board needs a correct answer. The number rolled is the difficulty:

  | Dice | 1 | 2 | 3 | 4 | 5 | 6 |
  |------|---|---|---|---|---|---|
  | Level | Very easy | Easy | Moderate | Tricky | Hard | Expert |

  The board rolls away and a world map rolls into view. Click the right country to move the piece forward. A wrong click or running out of time leaves it where it is.
- **Capturing:** land on a rival's square to send every rival piece on it back home. Your own pieces can share a square.
- **Winning:** the first player to bring **all** their pieces to the centre wins (51 squares round the loop, then 5 up your home column).

Optional rules, set on the start screen:
- A 6 earns another roll after bringing a piece out or answering correctly (on by default).
- You need an exact roll to reach the finish (off by default).
- Answer timer: 30 s, or 45 s for history questions (on by default).

### Game modes

| Mode | Questions |
|------|-----------|
| 🗺️ Geography | Find a country by its **name**, **flag**, **capital** or a **major city** |
| 📜 History & Geopolitics | The 240 questions in `data/history-questions.json` (40 per difficulty level) |
| 🎲 Mixed | Each question is randomly geography or history |

Every question is answered by clicking the country on the map.

**Geography difficulty:** every country has a *fame level* from 1 (everyone knows it) to 5 (an obscure micro-state). A question's level is the fame level plus a step for harder question types:

| Question type | Level |
|---------------|-------|
| Name | fame |
| Flag | fame + 1 |
| Capital | fame + 1 |
| Major city | fame + 1, + 2 or + 3 for the first, second or third city listed |

All 197 countries are included: the 193 UN members plus Vatican City, Palestine, Kosovo and Taiwan, each with its flag and capital. About 200 famous non-capital cities are also included. Capitals that are disputed or ambiguous are never asked: Israel, Palestine, Bolivia and Eswatini.

**Controls:** <kbd>Space</kbd> rolls the die. <kbd>1</kbd>–<kbd>4</kbd> choose a piece. <kbd>Enter</kbd> continues after an answer. On the map you can scroll or pinch to zoom, drag to pan, or use the + / − / ⤢ buttons. Very small countries are marked with dots.

## Project layout

```
index.html          markup for the setup screen, game screen and win overlay
css/style.css       styling, the 3D board/map "roll" and the 3D dice
js/fx.js            sound synthesised with WebAudio, confetti, dice animation
js/board.js         Ludo board geometry, SVG rendering, pawn movement
js/map.js           world map rendering, pan/zoom/pinch, click picking, answer reveal
js/quiz.js          question generator (6 levels, geography / history / mixed)
js/game.js          turn flow and game state
data/world.js       generated: projected country outlines, capitals, cities, fame levels
data/history-questions.json   history & geopolitics questions (edit this)
data/history.js     generated from history-questions.json
flags/*.svg         country flags (from flag-icons)
tools/build-data.js     regenerates data/world.js and flags/
tools/build-history.js  regenerates data/history.js
```

### Regenerating the data

```bash
npm i --prefix /tmp/geo world-atlas@2 topojson-client topojson-simplify d3-geo d3-geo-projection world-countries flag-icons polylabel@1
```

```bash
node tools/build-data.js /tmp/geo/node_modules
```

```bash
node tools/build-history.js
```

The fame levels, the major cities and the capitals that are never asked are listed at the top of `tools/build-data.js`.

To add or change history questions, edit `data/history-questions.json`, then run `node tools/build-history.js`. Each answer is given by its ISO 3166-1 alpha-2 code. The script stops with an error if a code doesn't match a country on the map.

Map notes:
- Crimea is shown as part of Ukraine, as recognised under international law and as the history questions expect. Natural Earth draws it as Russian.
- Somaliland is merged into Somalia and Northern Cyprus into Cyprus.

## Credits

- Country shapes: [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain)
- Country names and capitals: [world-countries](https://github.com/mledoze/countries) (ODbL)
- Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
