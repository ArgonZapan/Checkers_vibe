cmake_minimum_required(VERSION 3.14)
project(Checkers_vibe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

# Biblioteka silnika
add_library(engine STATIC
    src/board.cpp
    src/movegen.cpp
    src/engine.cpp
    src/minimax.cpp
)
target_include_directories(engine PUBLIC src)

# Testy
enable_testing()
add_executable(tests
    tests/test_moves.cpp
)
target_link_libraries(tests engine)

add_test(NAME move_tests COMMAND tests)

# ── REST server ──────────────────────────────────────────────────────
add_library(server_lib STATIC src/server.cpp)
target_include_directories(server_lib PUBLIC src vendor)
target_link_libraries(server_lib PUBLIC engine)

add_executable(checkers-server src/main.cpp)
target_link_libraries(checkers-server server_lib Threads::Threads)
