cmake_minimum_required(VERSION 3.14)
project(Checkers_vibe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Biblioteka silnika
add_library(engine STATIC
    engine/src/board.cpp
    engine/src/movegen.cpp
    engine/src/engine.cpp
)
target_include_directories(engine PUBLIC engine/src)

# Testy (disabled — no C++ test source yet)
# enable_testing()
# add_executable(tests
#     tests/test_moves.cpp
# )
# target_link_libraries(tests engine)
# add_test(NAME move_tests COMMAND tests)
