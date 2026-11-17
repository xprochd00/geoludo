# 🌍 GeoLudo — The World Race

A geography, history and culture board game inspired by Ludo. Roll the die, pick your challenge, then answer by clicking the right country on an interactive world map. Play with friends on one screen or against computer opponents.

## Play

There's nothing to install or build. Either:

- open `index.html` in a browser, or
- serve the folder, e.g. `python3 -m http.server` and open <http://localhost:8000>.

## 🎯 Solo training (`train.html`)

A phone-friendly practice page with just the questions and the map, no board. Open it from the link on the start screen, or go to `train.html` directly.

- Choose categories, levels and geography question types (countries, flags, capitals, cities, landmarks).
- New questions come first. **Missed questions come back** a few questions later until you get them right twice in a row; then they count as *mastered*.
- "🔁 Practise my mistakes" drills only the questions you've missed. There are also an optional timer, a free region hint and an "I don't know" button.
- Progress per category and level is kept in the browser. Training never changes which questions the real game asks.

## Rules

2–4 players share one computer (hot seat). Any seat can be a 🤖 computer player (Rookie, Explorer or Genius), so you can also play alone. Every move is earned by clicking the right country on the world map.

### Game length

| Preset | Length | Rules |
|--------|--------|-------|
| ⚡ **Quick** (default) | ~15–25 min | 1 piece each, starting on the board · pick your challenge · steals & hints · rescue questions |
| 🎲 **Classic** | ~45–90 min | 2 pieces each, starting at home (a 6 brings one out) · the dice sets the level · rescue questions |
| ⚙️ **Custom** | any | every rule below as a switch, plus 1–4 pieces per player (unequal counts work as a handicap) |

The lengths come from simulating thousands of games.

### Core rules

- **Pick your challenge** (Quick): after rolling, choose a question level from 1 (Very easy) to 6 (Expert). A correct answer moves you **roll + level** squares. Expert questions are worth up to 12 squares, Very easy ones 2–7. The best choice depends on what *you* know.
- **Dice sets the level** (Classic): the number rolled is the level (1 Very easy … 6 Expert), and you move that many squares.
- **Answering:** the board rolls away and a world map rolls into view. Click the right country. A wrong click or running out of time leaves the piece where it is.
- **Steals & hints:**
  - After a wrong answer, the next player gets 15 seconds to steal the question. A correct steal earns a 🧭 compass token, and so does a correct Expert answer (up to 3 tokens).
  - During any question, spend a token (or press <kbd>H</kbd>) to dim the map outside the answer's region.
  - Everyone starts with one token.
- **Leaving home** (Classic): a piece only comes out on a **6**, with no question needed. With nothing on the board you get **3 attempts** to roll that 6.
- **Choosing a piece:** if only one piece can move, it's picked automatically. Otherwise the pieces that can move glow: click one or press its number key. Pieces at home count as one choice.
- **Capturing and rescue questions:** land on a rival's square to send its pieces back (home in Classic, to their start square in Quick). With rescue questions on, the owner first gets a 🛡️ **rescue question**. A correct answer cancels the capture and sends the attacker back to where it came from. Your own pieces can share a square.
- **Rescue difficulty:** depends on how far the threatened piece has travelled. The 51-square loop is split into six zones:

  | Squares | 1–9 | 10–17 | 18–26 | 27–34 | 35–43 | 44–51 |
  |---------|-----|-------|-------|-------|-------|-------|
  | Rescue question | Very easy | Easy | Moderate | Tricky | Hard | Expert |

  Each player's progress bar is coloured with these zones and shows every piece. Pieces in the home column can't be captured.
- **Safe squares:** each player's first square (🛡️ shield) is safe. Rivals simply share it.
- **Winning:** the first player to bring **all** their pieces to the centre wins (51 squares round the loop, then 5 up the home column).
- **Other switches (Custom):** a 6 earns another roll; an exact roll is needed to reach the finish.
- **Options:** an answer timer (30 s, or 45 s for long text questions; 15 s for steals) and fast animations.

### Between games

- **Save and resume:** the game saves at the start of every turn. Reload the page or leave via ⟲, and the start screen offers **Resume**.
- **🛂 Passport:** every country a human player finds is stamped in a passport kept in the browser. The win screen lists the new stamps.
- **No repeats:** see below.

### Game modes

| Mode | Questions |
|------|-----------|
| 🗺️ Geography | Find a country by its **name**, **flag**, **capital** or a **major city**, plus the 52 extra questions in `data/geography-extra-questions.json` (landmarks, records …) |
| 📜 History & Geopolitics | The 378 questions in `data/history-questions.json` |
| ⚽ Sports | The 378 questions in `data/sports-questions.json` |
| 🎭 Culture | The 490 questions in `data/culture-questions.json`: music, film, art & architecture, literature, video games, traditions & food |
| 🎲 Mixed | Combine any two, three or all four categories (chosen on the start screen). Each chosen category gets an equal share: each question comes at random from whichever chosen categories have been asked least so far |

Every question is answered by clicking the country on the map.

**No repeats:** questions are drawn at random from those not asked yet. The record of asked questions is kept in the browser (`localStorage`), so it carries over between games and page reloads. Once every question at a level has been asked, new draws come from the least recently asked half. The game also avoids answer countries used in the last 8 questions. The start screen shows how many questions haven't been asked yet and has a **Reset question history** link.

**Geography difficulty:** every country has a *fame level* from 1 (everyone knows it) to 5 (an obscure micro-state). A question's level is the fame level plus a step for harder question types:

| Question type | Level |
|---------------|-------|
| Name | fame |
| Flag | fame + 1 + the country's `FLAG_ADJ` |
| Capital | fame + 1 + the country's `CAP_ADJ` |
| Non-capital city | the city's tier (1–6) in `data/cities.json` |

All 197 countries are included: the 193 UN members plus Vatican City, Palestine, Kosovo and Taiwan, each with its flag and capital. Also included: the 204 non-capital cities in `data/cities.json`. When a city question is answered, a 📍 pin shows where the city is. Antigua Guatemala is skipped because its name gives the answer away. Capitals that are disputed or ambiguous are never asked: Israel, Palestine, Bolivia and Eswatini.

**Controls:** <kbd>Space</kbd> rolls the die. <kbd>1</kbd>–<kbd>6</kbd> pick a challenge level; <kbd>1</kbd>–<kbd>4</kbd> choose a piece. <kbd>H</kbd> uses a hint. <kbd>Enter</kbd> continues after an answer. On the map you can scroll or pinch to zoom, drag to pan, or use the + / − / ⤢ buttons. Very small countries are marked with dots.

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
data/culture-questions.json   culture questions (edit this)
data/sports-questions.json    sports questions (edit this)
data/geography-extra-questions.json   extra geography questions (edit this)
data/cities.json    non-capital cities with tiers 1-6 (edit this)
data/history.js, culture.js, sports.js, geo-extra.js   generated from the question files
flags/*.svg         country flags (from flag-icons)
tools/build-data.js     regenerates data/world.js and flags/
tools/build-questions.js  regenerates the question data files (history, culture, sports, geography extra)
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

The fame levels, the per-country capital and flag difficulty adjustments (`CAP_ADJ`, `FLAG_ADJ`) and the capitals that are never asked are listed at the top of `tools/build-data.js`. Cities come from `data/cities.json`, so after editing it, run `tools/build-data.js` again.

To add or change questions, edit any of the `data/*-questions.json` files, then run `node tools/build-questions.js`. Question IDs must be unique across all the files. Each answer is given by its ISO 3166-1 alpha-2 code. The script stops with an error if a code doesn't match a country on the map.

Map notes:
- Crimea is shown as part of Ukraine, as recognised under international law and as the history questions expect. Natural Earth draws it as Russian.
- Somaliland is merged into Somalia and Northern Cyprus into Cyprus. Hong Kong and Macau are merged into China, where the city list places them.
- Only the 197 countries in the game's database (each with a name, flag and capital) can be clicked. Territories such as Greenland, New Caledonia or Western Sahara are drawn but can't be clicked.
- Tiny countries and island archipelagos (Bahamas, Solomon Islands, Vanuatu, Fiji …) are marked with gold dots so they can be clicked at world zoom. Territories get no dots.

## Credits

- Country shapes: [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain)
- Country names and capitals: [world-countries](https://github.com/mledoze/countries) (ODbL)
- Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
