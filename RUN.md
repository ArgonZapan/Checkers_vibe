# Uruchomienie Checkers_vibe

Projekt składa się z 3 komponentów uruchamianych niezależnie:
- **C++ Engine** — silnik gry (port 8080)
- **Node.js Server** — backend + AI (port 3000)
- **React Frontend** — interfejs web (port 5173 dev, serwowany przez Node w prod)

## Wymagania

- **Node.js** ≥ 18 (z npm)
- **C++ compiler** z obsługą C++17 (g++ lub clang++)
- **CMake** ≥ 3.14
- **Git**

Opcjonalnie:
- **Python 3** — do uruchamiania testów C++ (jeśli dodane)
- **Docker + Docker Compose** — dla uruchomienia w kontenerach

---

## Quick Start (wszystko naraz)

### 1. Sklonuj repo i zainstaluj zależności

```bash
git clone https://github.com/ArgonZapan/Checkers_vibe.git
cd Checkers_vibe

# Node dependencies (root + client + server)
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

### 2. Zbuduj i uruchom (Linux/macOS)

```bash
# Zbuduj C++ engine
mkdir -p build && cd build
cmake ..
make -j$(nproc)
cd ..

# Uruchom wszystko w tle (lub w osobnych terminalach)
./scripts/run-all.sh
```

Jeśli `scripts/run-all.sh` nie istnieje, uruchom ręcznie:

```bash
# Terminal 1: C++ engine
./build/engine-server     # jeśli istnieje binarka
# lub skompiluj w miejscu:
cd build && ./engine-server & cd ..

# Terminal 2: Node.js server
cd server && node index.js &

# Terminal 3: React frontend (dev mode)
cd client && npm run dev &
```

### 3. Otwórz przeglądarkę

- Frontend: http://localhost:5173
- lub serwowany przez Node: http://localhost:3000

---

## Krok po kroku

### C++ Engine

Silnik udostępnia REST API na porcie 8080.

```bash
# Budowanie
mkdir -p build
cd build
cmake ..
make -j$(nproc)

# Uruchomienie (nasłuchuje na 8080)
./engine-server
# lub jeśli nie ma osobnej binarki, uruchom testowy serwer httplib:
# (sprawdź engine/src/ — może wymagać dodatkowego pliku main.cpp)
```

> **Uwaga:** Jeśli `engine-server` nie istnieje jako osobna binarka, sprawdź `engine/src/` — projekt może wymagać dodania `main.cpp` z serwerem HTTP (używając cpp-httplib).

### Node.js Server

```bash
cd server
node index.js
```

- Nasłuchuje na porcie **3000**
- Serwuje statyczne pliki React (`../client/dist`) po zbudowaniu
- Proxy do C++ engine na `http://localhost:8080`
- Ustaw zmienną `COR` jeśli backend i frontend na różnych domenach:
  ```bash
  CORS_ORIGIN=http://localhost:5173 node index.js
  ```

### React Frontend (dev mode)

```bash
cd client
npm run dev
```

- Nasłuchuje na porcie **5173** (Vite domyślnie)
- Łączy się z Node.js Server na porcie 3000
- Zmiana `proxy` w `vite.config.js` jeśli server na innym porcie:

```js
// vite.config.js
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    }
  }
})
```

### Budowanie frontendu na produkcję

```bash
cd client
npm run build    # wynik w dist/
```

Zbudowany frontend jest serwowany przez Node.js Server.

---

## Tryby gry

Po uruchomieniu wszystkich komponentów i otwarciu http://localhost:3000 (lub :5173):

| Tryb | Opis |
|------|------|
| **PvAI** | Gracz (białe) vs AI (czarne) |
| **AI vs AI** | Self-play — obserwuj jak AI gra przeciwko sobie + dashboard statystyk |
| **PvP** | Dwie osoby przy jednym komputerze |

Konfigurację AI (epsilon, parametry sieci, strategie) znajdziesz w `config.js`.

---

## Zmienne środowiskowe

### Node.js Server (`server/index.js` lub `.env`)

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `PORT` | `3000` | Port serwera HTTP |
| `COR` | `http://localhost:3000` | Origin dla CORS |
| `CPP_BASE` | `http://localhost:8080` | Base URL C++ engine API |
| `CORS_ORIGIN` | (zobacz wyżej) | Origin dla cross-origin requests |
| `FETCH_TIMEOUT_MS` | `5000` | Timeout dla requestów do C++ |
| `AI_MOVE_DELAY_MS` | `0` | Opóźnienie ruchu AI (ms) |

### Client (Vite)

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `VITE_SERVER_URL` | `http://localhost:3000` | URL Node.js server |

---

## Testowanie

```bash
# Testy Node (Jest)
npm test

# Testy E2E (Playwright)
npm run test:e2e
```

> **Uwaga:** Testy E2E wymagają uruchomionego backendu (C++ + Node.js) na domyślnych portach.

---

## Docker Compose (opcjonalne)

Jeśli masz Docker, uruchom wszystko jedną komendą:

```bash
docker-compose up --build
```

lub osobno:

```bash
docker-compose up       # bez przebudowy
docker-compose down     # zatrzymaj
docker-compose logs -f  # podgląd logów
```

### Co robi Docker Compose

- **engine** — buduje i uruchamia C++ engine (port 8080)
- **server** — buduje i uruchamia Node.js + React (port 3000)
- ** Traefik** (opcjonalnie) — reverse proxy z HTTPS

---

## Rozwiązywanie problemów

### `Cannot connect to C++ engine on port 8080`

Upewnij się że engine działa:
```bash
curl http://localhost:8080/api/health
```

Jeśli nie działa, zbuduj i uruchom:
```bash
cd build && ./engine-server
```

### Module not found: `@tensorflow/tfjs-node`

TensorFlow.js wymaga specjalnej instalacji:
```bash
cd server && npm install
# Jeśli Apple Silicon: yarn install --ignore-optional
```

### Port already in use

Zmień port:
```bash
PORT=3001 node index.js
```

### CORS errors

Ustaw origin w config.js lub zmiennej `CORS_ORIGIN`:
```bash
CORS_ORIGIN=http://localhost:5173 node server/index.js
```

---

## Struktura portów

| Usługa | Port | Opis |
|--------|------|------|
| React (dev) | 5173 | Vite dev server |
| Node.js | 3000 | Express + socket.io + TensorFlow.js |
| C++ Engine | 8080 | REST API (httplib) |

W produkcji (z `npm run build` w client i Node serving static):
- Frontend dostępny na **3000** (ten sam port co Node.js)
- C++ engine nadal na **8080**
