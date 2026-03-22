cmake_minimum_required(VERSION 3.14)
project(Checkers_vibe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Biblioteka silnika
add_library(engine STATIC
    src/board.cpp
    src/movegen.cpp
    src/engine.cpp
)
target_include_directories(engine PUBLIC src)

# Testy
enable_testing()
add_executable(tests
    tests/test_moves.cpp
)
target_link_libraries(tests engine)

add_test(NAME move_tests COMMAND tests)
