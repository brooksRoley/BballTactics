CXX      := g++
CXXFLAGS := -std=c++17 -O2 -Iinclude

ROOT     := ../../..
INCDIR   := $(ROOT)/include
SRCDIR   := $(ROOT)/src

# All engine sources EXCEPT Bindings.cpp (requires <emscripten/bind.h>)
ENGINE_SRCS := \
	$(SRCDIR)/PlayerEntity.cpp \
	$(SRCDIR)/Court.cpp \
	$(SRCDIR)/Basketball.cpp \
	$(SRCDIR)/SynergyEngine.cpp \
	$(SRCDIR)/GameEconomy.cpp \
	$(SRCDIR)/GameSeason.cpp \
	$(SRCDIR)/ShotProbability.cpp

TARGET   := game_runner

.PHONY: all clean

all: $(TARGET)

$(TARGET): game_runner.cpp $(ENGINE_SRCS)
	$(CXX) $(CXXFLAGS) -I$(INCDIR) -o $@ $^

clean:
	rm -f $(TARGET)
