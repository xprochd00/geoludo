# 🌍 GeoGames — Geography games on a real world map

Geography board and race games: every move is earned by finding the right place on an interactive world map (countries, flags, capitals, cities, landmarks, history, sports and culture). Play on one device (hot seat) or **online, each on your own device** (phone, tablet or computer), by sharing a room link.

| Page | What it is |
|------|------------|
| `index.html` | 🌍 **GeoGames home**: a card per game, with a short description and the rules |
| `ludo/` | 🎲 **Geo Ludo**: the board race (Quick / Classic / Custom), hot seat or online |
| `voyage.html` | ⛵ **Geo Voyage**: sail around the world in 30 ports, hot seat or online |
| `timetravel.html` | ⏳ **Geo Time Travel**: from prehistory to today, three lives, hot seat or online |
| `train.html` | 🎯 **Training**: questions and map only, to practise on your own |

Every page has the same top bar (`js/nav.js`, `css/nav.css`): **← Home**, the GeoGames logo (also home), a **Games** menu and a **💬 Feedback** form (bug / wrong information / suggestion / general; it opens a prefilled GitHub issue, or the text can be copied). The bar steps aside while a game is being played, so the map keeps the room on phones. Old Voyage invitation links (`index.html?room=…`) are forwarded to `voyage.html`.

## Play

There's nothing to install or build. Either:

- open `index.html` (the GeoGames home) in a browser, or
- serve the folder, e.g. `python3 -m http.server` and open <http://localhost:8000>.

Online play needs the page to be served over the web (e.g. GitHub Pages, below), not opened as a file.

### Publishing on GitHub Pages

In the repository: **Settings → Pages → Deploy from a branch → `main` / root**. The pages are then at:

- `https://<user>.github.io/geoludo/`: Voyage
- `https://<user>.github.io/geoludo/train.html`: Solo training
- `https://<user>.github.io/geoludo/ludo/`: Classic

## ⛵ Voyage rules

- **Setup:** choose the question categories (one, several to mix them in equal shares, or **All**; tapping *All* again goes back to the category you chose last). The **type of geography questions** (all, countries, flags, capitals, cities, landmarks & facts) is chosen on the Geography tile; the same choices exist in GeoLudo, then **Hot seat** (take turns on one device, 1–6 players) or **Online** (2–6 players, each on their own device).
- **Your turn:** pick a challenge from **1 (Very easy) to 6 (Expert)**. Each button shows the port you would reach. Answer correctly and your ship sails that many ports. A wrong answer costs nothing; you just stay in port.
- **The route:** 30 legs around the world, westward from Lisbon via Dakar, Rio, Cape Horn, Tahiti, Sydney, Singapore, the Maldives, Mumbai, Djibouti and the Suez Canal, back to Lisbon (`data/route.json`).
- **Compass tokens 🧭:** everyone starts with one (max 3). Land **exactly** on one of the six 🧭 treasure ports (the level buttons mark the challenge that lands there), or answer **3 in a row**, to find another. During your question, spend one (button or **H**) to highlight the region the answer is in.
- **Hazards ⚠️:** after a correct answer, the port you reach may hold a hazard that fits the place: storms, cyclones, monsoon, icebergs (Ushuaia), reefs and fog blow the ship back 1–2 ports; the doldrums, pirates (Malacca, Djibouti) or a canal jam (Port Said) cost the next turn. The chance falls with the level answered: 35%, 28%, 21%, 14%, 8%, 3% for levels 1–6, shown on each level button, so a bold challenge also means safer sailing. No hazard at the finish.
- **No attacks:** ships can share ports. Nobody is captured or sent back.
- **Fair finish:** when the first ship reaches Lisbon, the round is completed so everyone has had the same number of turns. The ship that sailed furthest wins (overshooting the finish counts), then the best accuracy.
- **Timer:** 30 s per question, 45 s for longer text questions.
- **Computer captains 🤖:** in hot seat, tap a player's *Human ▾* button and choose Rookie, Explorer or Genius (accuracy falls with the level, as in GeoLudo). Bots weigh the risk of each level, aim for treasure ports and use their compass on hard questions.
- **Hot seat** saves after every turn: reload the page and choose **Resume**.

### Online rooms

1. Choose **Online**, enter your name and press **Create a room**.
2. Send the invitation link (or the 5-letter room code) to your friends. They open it, enter their name and join.
3. The host can also **add computer captains** (🤖 Rookie, Explorer or Genius; tap the level to choose another, ✕ to remove).
4. When everyone is in the lobby, the host presses **Start**.

Each player sees the same map. Only the active player can pick and answer. Everyone else can **guess along**: it doesn't move their ship, but the reveal shows who also knew it ("👀 Also knew it: Ana"), and the final table counts it.

Under the hood, the host's browser runs the game. All devices exchange messages through a free **public relay** (an MQTT message broker reached over a secure WebSocket, the same kind of connection websites use), so it works on mobile data and home Wi-Fi alike. Several public relays are tried in turn (`js/net.js`), and the invitation link records which one the host is using. There's no game server of our own. Some consequences:

- The **host must keep the page open**. If the host leaves, the voyage ends.
- A player who loses connection is shown as offline (at once when the page closes, at most 30 s when the phone just goes silent). **20 s later a bot (Explorer level) sails their ship** until they come back by opening the link again (same phone, or any device with the same name); they then take the helm again.
- Some school or office networks block these relays. Mobile data usually works.
- Public relays are shared services without guarantees, and anyone who knew the room code could in theory send messages. That's fine for a game among friends.
- On a portrait phone the world map is small: pinch to zoom, or turn the phone sideways.

## 🇺🇸 US states and Canadian provinces

Every game's setup (Geo Ludo, Geo Voyage, Training) has a **Map** menu with three options:

| Map | What is asked | The map |
|-----|---------------|---------|
| 🌍 **World** | countries, as before | the world |
| 🌎 **World + US states & Canada** | countries **and** the 50 US states, 10 Canadian provinces and 3 territories, in every chosen category | the USA and Canada split into states and provinces; a tapped state counts for its country in a country question |
| 🇺🇸 **US states & Canadian provinces** | only those, in the categories you choose (Geography, History, Sports, Culture) | North America; other countries are greyed out |

The same question types as for countries: **find it on the map, flag, capital** (with a 📍 pin after the answer), **cities** (`data/na-cities.json`, 50) and **landmarks & facts** (`data/na-questions.json`, 50). Difficulty comes from a fame level per state/province (`data/na-regions.json`): finding it = fame, its flag = fame + 2 (state flags are hard), its capital = fame + 1, adjusted for famous capitals (−1) and traps like Sacramento or Albany (+1).

**History, Sports and Culture** have 100 questions each about the US states and Canadian provinces (`data/na-history.json`, `data/na-sports.json`, `data/na-culture.json`, levels 1–6), tagged e.g. "US · History" or "Canada · Sport". The **World** map never asks them; the other two maps mix them into the chosen categories. Questions about states and provinces always say *state* or *province*, never *country*. The "show region" hint names a US census region (Northeast, Midwest, South, West) or a part of Canada (Western, Central, Atlantic, Northern).

**Geo Voyage** with "US states & Canadian provinces" sails its own route, **From Sea to Sea** (`data/route-na.json`, 25 legs): Montreal → Quebec City → Halifax → Saint John → Portland → Boston → New York → … → Miami → Key West → the Gulf of Mexico → (Panama Canal) → San Diego → Los Angeles → San Francisco → … → Seattle → Victoria → **Vancouver**, with hurricanes in the Gulf, fog on the Pacific coast and ice in the St. Lawrence. The other two maps keep the round-the-world route from Lisbon.

Data: `data/regions.js` is built by `tools/build-data.js` from Natural Earth's admin-1 outlines (`ne_50m_admin_1_states_provinces_lakes.geojson`, placed in `<node_modules>/natural-earth/`), projected exactly like the countries. Flags in `flags/regions/` are public domain (the `region-flags` package), optimised with svgo.

## ⏳ Geo Time Travel (`timetravel.html`)

A history race through five eras: **Prehistory → Antiquity → Middle Ages → Early Modern → Modern → today**.

- On your turn you get a question from your current era and answer it by tapping the country on the map (45 s).
- Each era needs a number of correct answers before you travel on: **Short 2, Standard 3, Long 4**.
- **Lives:** you start with 3. A wrong answer or a timeout costs one; arriving in a new era gives one back (up to 5).
- **Eliminated** at 0 lives, by a threat of your era, with a short animated scene: a sabre-toothed cat, mammoths or a volcano; Spartan warriors, the arena's lions or a legion; the Black Death, Vikings or arrows from castle walls; pirates, cannon fire or the Great Fire of London; the Titanic's iceberg, a runaway train or a time machine failure.
- **Winning:** the first traveller to reach today ends the journey once the round is complete, so everyone has had the same number of turns. Eliminated travellers sit out and the others play on; if nobody reaches today, the journey ends when the last traveller is out, and the one who got furthest wins.
- Questions come from their own pool, `data/timetravel-questions.json` (450 questions: prehistory 45, antiquity 78, Middle Ages 83, early modern 118, modern 126). They are not graded by difficulty, are drawn at random and never repeat in a game. `node tools/build-timetravel.js` turns the file into `data/timetravel.js` (checks IDs, duplicates and that every answer is a playable country).
- Hot seat (1–6 players, bots) or online (same rooms as Voyage, on their own channel; a bot plays for a player who goes offline after 20 s).

## 🎯 Solo training (`train.html`)

A phone-friendly practice page with just the questions and the map, no board. Open it from the start screen, or go to `train.html` directly.

- Choose categories, levels and geography question types (countries, flags, capitals, cities, landmarks). **⏳ Time Travel** is a category too: Geo Time Travel's 450 history questions, chosen by era (prehistory … modern) instead of by level, so the level chips are hidden when Time Travel is the only category. Time Travel isn't offered on the US states & Canadian provinces map. Each row has an **All** chip; tapping it again keeps only the option you chose last.
- **Parts of the world:** practise Europe, Africa, Asia (without South-East Asia), Oceania & South-East Asia, or the Americas (with Tonga, Samoa and Kiribati, which sit next to them on the map), in any combination. A question belongs to the part where its answer country is, and the map opens on the chosen parts.
- New questions come first. **Missed questions come back** a few questions later (never straight away) until you get them right twice in a row; then they count as *mastered*. Every 6th question revisits a mastered one (the one practised longest ago), and questions from the last few turns are avoided, so a fully mastered set keeps rotating.
- "🔁 Practise my mistakes" drills only the questions you've missed. There are also an optional timer, a free region hint and an "I don't know" button.
- Progress per category and level is kept in the browser. Training never changes which questions the games ask.

## 🎲 GeoLudo Classic rules (`ludo/`)

The earlier Ludo-board version is kept in `ludo/` with frozen copies of its code and styles; it shares the question data and flags with the rest of the site.


2–4 players share one device (**hot seat**) or play **online**, each on their own device. Any seat can be a 🤖 computer player (Rookie, Explorer or Genius), so you can also play alone. Every move is earned by clicking the right country on the world map.

### Online rooms

1. Choose **Online**, pick the questions, game length and options, enter your name and press **Create a room**.
2. Send the invitation link. Friends open it, enter their name and join (up to 4 players). The host can add, re-level and remove 🤖 computer players. With **Custom** rules, the host also sets each player's number of pieces (1–4) in the lobby.
3. The host presses **Start**. Each player rolls, picks and answers on their own device; everyone sees the same board and map.

How it stays in step: every device runs the same game from the same random seed, so dice, questions and bots come out identical everywhere. Only decisions travel (roll, piece, level, answer, hint, continue): the host numbers them and sends them to all devices through the same public relay as Voyage (`ludo/js/net.js`, its own channel), and each device applies a decision when its game reaches that point (`ludo/js/online.js`, `point()` in `ludo/js/game.js`).

- **Reload or rejoin:** open the link again (same device, or any device with the same name). The device replays the game without animations and catches up.
- **Lost connection:** a player is shown as offline at once when the page closes, or after 30 s of silence. **20 s later a bot (Explorer level) plays for them** until they are back. The host makes those decisions, so all devices stay identical.
- **Idle players:** the answer timer still applies; after 60 s without a roll or choice the host decides for them.
- The host's page must stay open; online games aren't saved for Resume. On a joining device, that device's own question history is left untouched.

### Game length

| Preset | Length | Rules |
|--------|--------|-------|
| ⚡ **Quick** (default) | ~15–25 min | 1 piece each, starting on the board · pick your challenge · steals & hints · rescue questions |
| 🎲 **Classic** | ~45–90 min | 2 pieces each, starting at home (a 6 brings one out) · the dice sets the level · rescue questions |
| ⚙️ **Custom** | any | every rule below as a switch, plus 1–4 pieces per player (unequal counts work as a handicap) |

The lengths come from simulating thousands of games.

### Core rules

- **Pick your challenge** (Quick): first choose a question level from 1 (Very easy) to 6 (Expert), then roll. A correct answer moves you **roll + level** squares. Expert questions are worth up to 12 squares, Very easy ones 2–7. Choosing before the roll means you commit to a challenge without knowing how far it will take you; the best choice depends on what *you* know. (With no piece on the board yet, you simply roll for the 6.)
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
- **No repeats:** see below.

## Questions (shared by all three parts)

| Category | Questions |
|----------|-----------|
| 🗺️ Geography | Find a country by its **name**, **flag**, **capital** or a **major city**, plus the 52 extra questions in `data/geography-extra-questions.json` (landmarks, records …) |
| 📜 History & Geopolitics | The 473 questions in `data/history-questions.json` |
| ⚽ Sports | The 468 questions in `data/sports-questions.json` |
| 🎭 Culture | The 490 questions in `data/culture-questions.json`: music, film, art & architecture, literature, video games, traditions & food |
| Mixed | Choosing several categories mixes them in equal shares: each question comes at random from whichever chosen categories have been asked least so far |

Every question is answered by clicking the country on the map.

**Pool sizes per level.** Because Voyage players choose their own level, the middle levels are picked most, so levels 3 and 4 have the largest pools:

| Level | 1 | 2 | 3 | 4 | 5 | 6 |
|-------|---|---|---|---|---|---|
| History | 60 | 78 | 101 | 100 | 74 | 60 |
| Sports | 60 | 69 | 100 | 106 | 73 | 60 |
| Culture | 60 | 81 | 100 | 103 | 86 | 60 |

Questions added to reach these sizes are marked `"source": "generated"` in the JSON files, so they can be reviewed.

**No repeats:** questions are drawn at random from those not asked yet. The record of asked questions is kept in the browser (`localStorage`), so it carries over between games and page reloads. Once every question at a level has been asked, new draws come from the least recently asked half. The game also avoids answer countries used in the last 8 questions. The start screen shows how many questions haven't been asked yet and has a **Reset question history** link.

**Geography difficulty:** every country has a *fame level* from 1 (everyone knows it) to 5 (an obscure micro-state). A question's level is the fame level plus a step for harder question types:

| Question type | Level |
|---------------|-------|
| Name | fame |
| Flag | fame + 1 + the country's `FLAG_ADJ` |
| Capital | fame + 1 + the country's `CAP_ADJ` |
| Non-capital city | the city's tier (1–6) in `data/cities.json` |

All 197 countries are included: the 193 UN members plus Vatican City, Palestine, Kosovo and Taiwan, each with its flag and capital. Also included: the 100 non-capital cities in `data/cities.json`. When a city or capital question is answered, a 📍 pin shows where the city is (capital positions: `data/capitals.json`, from GeoNames). Antigua Guatemala is skipped because its name gives the answer away. Capitals that are disputed or ambiguous are never asked: Israel, Palestine, Bolivia and Eswatini.

**Controls:** on the map, scroll or pinch to zoom, drag to pan, or use the + / − / ⤢ buttons. Very small countries are marked with dots. Voyage keys: <kbd>1</kbd>–<kbd>6</kbd> pick a challenge, <kbd>Enter</kbd> next, <kbd>Esc</kbd> menu.

## Project layout

```
index.html          🌍 GeoGames home (css/hub.css)
voyage.html         ⛵ Geo Voyage (setup, lobby, game)
js/nav.js           top bar on every page: Home, logo, Games menu, Feedback form (css/nav.css)
js/voyage.js        Voyage: rules engine (runs on the host), rendering, ships & route, hot seat and online wiring
js/net.js           online rooms through a public MQTT relay (a small built-in client): host / join / reconnect
css/voyage.css      Voyage styles
train.html, js/train.js, css/train.css   🎯 Solo training
ludo/               🎲 GeoLudo Classic (its own frozen copies of index.html, js/ and css/; online rooms in ludo/js/online.js)
css/style.css       shared base styles (cards, buttons, map, question card)
js/map.js           world map: rendering, pan/zoom/pinch, picking (larger tap areas for tiny nations), answer reveal, overlay layer
js/dialog.js        in-game confirm/alert dialogs (copy in ludo/js/)
js/quiz.js          question pools and selection (6 levels, categories, no repeats)
js/fx.js            sound (WebAudio), confetti
data/world.js       generated: projected country outlines, capitals, cities, fame levels, the voyage route
data/route.json     the voyage route: ports and sea waypoints (edit this)
data/history-questions.json   history & geopolitics questions (edit this)
data/culture-questions.json   culture questions (edit this)
data/sports-questions.json    sports questions (edit this)
data/geography-extra-questions.json   extra geography questions (edit this)
data/cities.json    non-capital cities with tiers 1-6 (edit this)
data/capitals.json  capital positions (lat/lon per country), shown as a pin after capital questions
data/history.js, culture.js, sports.js, geo-extra.js   generated from the question files
flags/*.svg         country flags (from flag-icons)
tools/build-data.js     regenerates data/world.js (including the route) and flags/
tools/build-questions.js  regenerates the question data files
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

The fame levels, the per-country capital and flag difficulty adjustments (`CAP_ADJ`, `FLAG_ADJ`) and the capitals that are never asked are listed at the top of `tools/build-data.js`. Cities come from `data/cities.json` and the voyage route from `data/route.json`, so after editing either, run `tools/build-data.js` again.

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
- Online rooms: public MQTT brokers ([EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker), [HiveMQ](https://www.hivemq.com/mqtt/public-mqtt-broker/), [Eclipse](https://mqtt.eclipseprojects.io/), [Mosquitto](https://test.mosquitto.org/))
