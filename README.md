# Checkers_vibe

> Warcaby — vibe coded.

## Co to jest?

Klasyczne warcaby (ang. checkers / draughts) jako web app. Dwóch graczy, 8×8, bicie obowiązkowe.

## Plan

- [ ] Plansza 8×8
- [ ] Logika ruchu (zwykły + bicie)
- [ ] Bicie wielokrotne
- [ ] Promocja na damkę
- [ ] Gracz vs AI
- [ ] AI vs AI (obserwacja)

## AI

Sieć neuronowa (ten sam model dla obu stron). Różne parametry = różne style gry.

- Modele wczytywane przy starcie serwera
- Auto-zapis co 5 minut
- Self-play: AI vs AI → zbieranie danych z gry → po zakończeniu szkolenie na danych + aktualizacja wag → kolejna gra automatycznie
- Replay buffer: ostatnie 10k ruchów (FIFO)
- Auto-zapis bufora na dysk co 10 minut (binarny)
- [ ] UI — czyste, responsywne
- [ ] Animacje ruchów

## Stack

- **Backend:** C++
- **Frontend:** React (Node.js)

## Jak uruchomić

TBD

## Status

🏗️ Planowanie
