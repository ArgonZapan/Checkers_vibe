# API — C++ Engine (port 8080)

## Endpointy

### GET /api/status
Stan silnika.

Odpowiedź:
- `ready: bool`
- `gamesPlayed: int`

### POST /api/game/start
Rozpocznij nową grę.

Odpowiedź:
- `board: [[int]]` — 8x8 tablica (0=puste, 1=biały pionek, 2=biała damka, 3=czarny pionek, 4=czarna damka)
- `turn: "white" | "black"`

### GET /api/game/state
Aktualny stan planszy.

### GET /api/legal-moves
Dostępne ruchy dla aktualnego gracza.

Odpowiedź:
- `moves: [{from: [r,c], to: [r,c], captures: [[r,c]]}]`

### POST /api/move
Wykonaj ruch.

Parametry:
- `from: [row, col]`
- `to: [row, col]`

Odpowiedź:
- `board: [[int]]`
- `turn: "white" | "black"`
- `gameOver: bool`
- `winner: "white" | "black" | "draw" | null`

### POST /api/game/reset
Resetuj planszę.

### POST /api/board/set
Ustaw planszę z zewnątrz (do szkolenia).

Parametry:
- `board: [[int]]`
- `turn: "white" | "black"`
