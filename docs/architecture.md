# Architektura systemu

## Struktura

```
┌─────────────────────────────────────────────────┐
│                 Przeglądarka                     │
│              React (Frontend)                    │
└────────────────────┬────────────────────────────┘
                     │ HTTP/WebSocket
┌────────────────────▼────────────────────────────┐
│              Node.js (Express)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────┐ │
│  │ Web Server  │  │ TensorFlow.js│  │ Proxy  │ │
│  │ (static)    │  │ (training)   │  │ → C++  │ │
│  └─────────────┘  └──────────────┘  └────────┘ │
└────────────────────┬────────────────────────────┘
                     │ HTTP REST
┌────────────────────▼────────────────────────────┐
│              C++ Engine                          │
│  ┌─────────────┐  ┌──────────────┐              │
│  │ Game Logic  │  │ REST API     │              │
│  │ (bitboard)  │  │ (HTTP)       │              │
│  └─────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

## Komponenty

### C++ Engine (port 8080)
- Silnik gry (bitboard, reguły, generowanie ruchów)
- REST API — endpointy do gry i stanu
- NIE robi szkolenia — tylko logika gry

### Node.js Server (port 3000)
- Express — serwuje statyczne pliki React
- Proxy — przekazuje requesty do C++ API
- TensorFlow.js — sieć neuronowa, szkolenie, predykcja
- Replay buffer — przechowywanie danych treningowych
- WebSocket — real-time updates do frontendu

### React Frontend
- Plansza warcab
- Kontrolki gry (tryb, start, stop)
- Dashboard AI vs AI (wykres loss, statystyki, historia)
- Panel parametrów (epsilon, rozmiar sieci, restart)

## Przepływ danych

### Gra PvAI
1. Użytkownik klika ruch → React → Node.js
2. Node.js → C++ API: `POST /api/move`
3. C++ sprawdza legalność, wykonuje ruch, zwraca stan
4. Node.js → C++ API: `GET /api/legal-moves`
5. Node.js → TensorFlow.js: predykcja ruchu AI
6. AI ruch → C++ API: `POST /api/move`
7. Node.js → WebSocket → React: aktualizacja planszy

### Szkolenie (AI vs AI)
1. Node.js → C++ API: pętla gry (ruch po ruchu)
2. Każdy ruch → zapis do replay buffer
3. Po grze → TensorFlow.js: szkolenie na mini-batch
4. Aktualizacja wag → zapis na dysk
5. Kolejna gra automatycznie

## Porty
- C++: 8080
- Node.js: 3000
- Frontend: serwowany przez Node.js na porcie 3000
