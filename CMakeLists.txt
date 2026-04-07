cmake_minimum_required(VERSION 3.15)
project(BBallTacticsEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Shared core (submodule) provides headers and engine sources
set(CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/shared-core")
include_directories(${CORE_DIR}/include)

set(CORE_SOURCES
    ${CORE_DIR}/src/PlayerEntity.cpp
    ${CORE_DIR}/src/Court.cpp
    ${CORE_DIR}/src/Basketball.cpp
    ${CORE_DIR}/src/SynergyEngine.cpp
    ${CORE_DIR}/src/GameEconomy.cpp
    ${CORE_DIR}/src/GameSeason.cpp
    ${CORE_DIR}/src/ShotProbability.cpp
    ${CORE_DIR}/src/GameManager.cpp
)

# Bindings.cpp is consumer-specific (WASM embind for this project)
set(SOURCE_FILES
    ${CORE_SOURCES}
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
