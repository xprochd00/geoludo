# 🌍 GeoLudo — The World Race

A geography, history and culture board game inspired by Ludo. Roll the die, pick a piece, then answer by clicking the right country on an interactive world map to move it forward.

## Play

There's nothing to install or build. Either:

- open `index.html` in a browser, or
- serve the folder, e.g. `python3 -m http.server` and open <http://localhost:8000>.

## Rules

- 2–4 players take turns on one computer (hot seat). Each player picks how many pieces (1–4) they race with. All pieces start in the home yard.
- **Leaving home:** a piece can only come out on a **6**. Bringing a piece out needs no question. With no piece on the board, you get **3 attempts** to roll that 6.
- **Choosing a piece:** if only one piece can move, it is picked automatically. Otherwise the pieces that can move glow: click the one you want, or press its number key. On a 6 you can either bring out a new piece or move one already on the board. Pieces at home count as one choice, because they are interchangeable.
- **Moving:** moving a piece on the board needs a correct answer. The number rolled is the difficulty:

  | Dice | 1 | 2 | 3 | 4 | 5 | 6 |
  |------|---|---|---|---|---|---|
  | Level | Very easy | Easy | Moderate | Tricky | Hard | Expert |

  The board rolls away and a world map rolls into view. Click the right country to move the piece forward. A wrong click or running out of time leaves it where it is.
- **Capturing and rescue questions:** when you land on a rival's square, its owner gets a 🛡️ **rescue question**. Get it right and the capture is cancelled: the attacking piece goes back to where it came from. Get it wrong (or run out of time) and the rival piece goes home. Your own pieces can share a square.
- **Rescue difficulty:** depends on how far the threatened piece has travelled. The 51-square loop is split into six zones, from Very easy near the start to Expert near the end:

  | Squares | 1–9 | 10–17 | 18–26 | 27–34 | 35–43 | 44–51 |
  |---------|-----|-------|-------|-------|-------|-------|
  | Rescue question | Very easy | Easy | Moderate | Tricky | Hard | Expert |

  Each player's progress bar is coloured with these zones and shows every piece on it, so you can always see what you would face. Pieces in the home column can't be captured.
- **Safe squares:** each player's first square, marked with a 🛡️ shield, is a safe zone. Pieces standing there can't be captured, so rivals simply share the square.
- **Winning:** the first player to bring **all** their pieces to the centre wins (51 squares round the loop, then 5 up your home column).

Optional rules, set on the start screen:
- A 6 earns another roll after bringing a piece out or answering correctly (on by default).
- You need an exact roll to reach the finish (off by default).
- Answer timer: 30 s, or 45 s for history and culture questions (on by default).

### Game modes

| Mode | Questions |
|------|-----------|
| 🗺️ Geography | Find a country by its **name**, **flag**, **capital** or a **major city** |
| 📜 History & Geopolitics | The 360 questions in `data/history-questions.json` (60 per difficulty level) |
| 🎭 Sports & Culture | The 420 questions in `data/culture-questions.json` (70 per level): music, film, art, sport, literature and games |
| 🎲 Mixed | Combine two or all three categories (chosen on the start screen). Each chosen category gets an equal share: each question comes at random from whichever chosen categories have been asked least so far |

Every question is answered by clicking the country on the map.

**No repeats:** questions are drawn at random from those not asked yet. The record of asked questions is kept in the browser (`localStorage`), so it carries over between games and page reloads. Once every question at a level has been asked, new draws come from the least recently asked half. The game also avoids answer countries used in the last 8 questions. The start screen shows how many questions haven't been asked yet and has a **Reset question history** link.

**Geography difficulty:** every country has a *fame level* from 1 (everyone knows it) to 5 (an obscure micro-state). A question's level is the fame level plus a step for harder question types:

| Question type | Level |
|---------------|-------|
| Name | fame |
| Flag | fame + 1 |
| Capital | fame + 1 |
| Non-capital city | the city's tier (1–6) in `data/cities.json` |

All 197 countries are included: the 193 UN members plus Vatican City, Palestine, Kosovo and Taiwan, each with its flag and capital. Also included: the 198 non-capital cities in `data/cities.json` (33 per tier). When a city question is answered, a 📍 pin shows where the city is. Antigua Guatemala is skipped because its name gives the answer away. Capitals that are disputed or ambiguous are never asked: Israel, Palestine, Bolivia and Eswatini.

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
data/culture-questions.json   sports & culture questions (edit this)
data/cities.json    non-capital cities with tiers 1-6 (edit this)
data/history.js, data/culture.js   generated from the question files
flags/*.svg         country flags (from flag-icons)
tools/build-data.js     regenerates data/world.js and flags/
tools/build-questions.js  regenerates data/history.js and data/culture.js
```

### Regenerating the data

```bash
npm i --prefix /tmp/geo world-atlas@2 topojson-client topojson-simplify d3-geo d3-geo-projection world-countries flag-icons polylabel@1
```

```bash
node tools/build-data.js /tmp/geo/node_modules
```

```bash
node tools/build-questions.js
```

The fame levels and the capitals that are never asked are listed at the top of `tools/build-data.js`. Cities come from `data/cities.json`, so after editing it, run `tools/build-data.js` again.

To add or change questions, edit `data/history-questions.json` or `data/culture-questions.json`, then run `node tools/build-questions.js`. Each answer is given by its ISO 3166-1 alpha-2 code. The script stops with an error if a code doesn't match a country on the map.

Map notes:
- Crimea is shown as part of Ukraine, as recognised under international law and as the history questions expect. Natural Earth draws it as Russian.
- Somaliland is merged into Somalia and Northern Cyprus into Cyprus. Hong Kong and Macau are merged into China, where the city list places them.
- Only the 197 countries in the game's database (each with a name, flag and capital) can be clicked. Territories such as Greenland, New Caledonia or Western Sahara are drawn but can't be clicked.
- Tiny countries and island archipelagos (Bahamas, Solomon Islands, Vanuatu, Fiji …) are marked with gold dots so they can be clicked at world zoom. Territories get no dots.

## Credits

- Country shapes: [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain)
- Country names and capitals: [world-countries](https://github.com/mledoze/countries) (ODbL)
- Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
