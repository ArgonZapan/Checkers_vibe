# Checkers_vibe

> Warcaby — vibe coded.

## Co to jest?

Klasyczne warcaby (ang. checkers / draughts) jako web app. Dwóch graczy, 8×8, bicie obowiązkowe.

## Plan

- [ ] Silnik gry (C++, bitboard) ✅ podstawy
- [ ] REST API (C++)
- [ ] Node.js server (Express + proxy do C++)
- [ ] Plansza React
- [ ] Sieć neuronowa (TensorFlow.js)
- [ ] Tryb PvAI
- [ ] Tryb AI vs AI (self-play)
- [ ] Dashboard (loss, statystyki, parametry)
- [ ] Replay buffer + auto-save
- [ ] Auto-zapis modeli

## Stack

- **Backend:** C++ (silnik gry, REST API)
- **Frontend:** React (Node.js)
- **Server:** Node.js (Express, TensorFlow.js, proxy)
- **AI engine:** TensorFlow.js (tfjs-node)

## AI

Sieć neuronowa (ten sam model dla obu stron). Różne parametry = różne style gry.

- Modele wczytywane przy starcie serwera
- Auto-zapis co 5 minut
- Self-play: AI vs AI → zbieranie danych z gry → po zakończeniu szkolenie na danych + aktualizacja wag → kolejna gra automatycznie
- Replay buffer: ostatnie 10k ruchów (FIFO)
- Auto-zapis bufora na dysk co 10 minut (binarny)

## Tryby

- [ ] Gracz vs AI
- [ ] AI vs AI (obserwacja + dashboard)

## Dokumentacja

- [Architektura](docs/architecture.md) — struktura systemu, komponenty, przepływ danych
- [Silnik gry](docs/engine.md) — zasady, bitboard, generowanie ruchów
- [Sieć neuronowa](docs/neural-network.md) — architektura, warianty, parametry
- [Self-play](docs/self-play.md) — cykl uczenia, replay buffer, dashboard
- [API C++](docs/api-cpp.md) — endpointy silnika
- [API Node.js](docs/api-node.md) — endpointy serwera, WebSocket

## Status

✅ Dojrzały projekt — 130+ testów (3,281 testów przechodzących), pełny frontend React, serwer WebSocket + TensorFlow.js + SelfPlay

## Uruchomienie

TBD
