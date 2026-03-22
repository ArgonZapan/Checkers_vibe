# API — Node.js Server (port 3000)

## Proxy do C++
Wszystkie requesty `/api/*` są przekazywane do C++ na port 8080.

## Własne endpointy

### GET /api/ai/info
Informacje o modelu AI.

Odpowiedź:
- `modelLoaded: bool`
- `version: int`
- `epsilon: float`
- `networkSize: string` ("small" | "medium" | "large")
- `gamesPlayed: int`
- `bufferSize: int`

### POST /api/ai/predict
Predykcja ruchu przez sieć.

Parametry:
- `board: [[int]]`
- `turn: "white" | "black"`
- `legalMoves: [{from, to, captures}]`

Odpowiedź:
- `move: {from, to}` — wybrany ruch
- `probabilities: [float]` — prawdopodobieństwa dla każdego ruchu
- `value: float` — ocena pozycji (-1 do +1)

### POST /api/ai/train
Wymuś jedną rundę szkolenia.

Odpowiedź:
- `loss: float`
- `bufferSize: int`
- `samplesUsed: int`

### POST /api/ai/params
Zmień parametry modelu.

Parametry:
- `epsilon?: float` (0.0 - 1.0)
- `networkSize?: "small" | "medium" | "large"`

### POST /api/ai/restart
Restartuj model (losowe wagi).

Parametry:
- `side?: "white" | "black" | "both"` — który model restartować

### GET /api/ai/stats
Statystyki treningowe.

Odpowiedź:
- `totalGames: int`
- `whiteWins: int`
- `blackWins: int`
- `draws: int`
- `avgGameLength: float`
- `lossHistory: [float]`

### POST /api/selfplay/start
Rozpocznij AI vs AI.

### POST /api/selfplay/stop
Zatrzymaj AI vs AI.

### GET /api/selfplay/status
Stan self-play.

Odpowiedź:
- `active: bool`
- `currentGame: int`
- `currentTurn: "white" | "black"`
- `board: [[int]]`

## WebSocket

### Kanał: /ws
Eventy:
- `move` — `{board, turn, move, gameOver, winner}`
- `gameStart` — `{gameNumber}`
- `gameEnd` — `{winner, moves, gameNumber}`
- `train` — `{loss, bufferSize}`
- `paramsChange` — `{side, epsilon, networkSize}`
- `modelRestart` — `{side}`
