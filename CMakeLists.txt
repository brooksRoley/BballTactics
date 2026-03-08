cmake_minimum_required(VERSION 3.15)
project(BBallTacticsEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Header search path
include_directories(include)

set(SOURCE_FILES
    src/PlayerEntity.cpp
    src/Court.cpp
    src/Basketball.cpp
    src/SynergyEngine.cpp
    src/GameEconomy.cpp
    src/GameSeason.cpp
    src/ShotProbability.cpp
    src/GameManager.cpp
    src/Bindings.cpp
)

# Optimization flags
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -Wall -Wextra")

# Emscripten specific linker flags
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -lembind -sWASM=1 -sMODULARIZE=1 -sEXPORT_NAME=Module -sALLOW_MEMORY_GROWTH=1")

# Compiled output drops into the Vite public folder for dev/build
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/public")

add_executable(engine ${SOURCE_FILES})
set_target_properties(engine PROPERTIES SUFFIX ".js")
