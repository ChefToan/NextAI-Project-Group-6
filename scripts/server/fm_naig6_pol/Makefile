#
# Makefile for fm_naig6_custom.so  (Group 6 NextAI custom FM)
#
# Build on the box:
#   cd $PIN_HOME/source/sys/fm_naig6_pol
#   make            # -> fm_naig6_custom.so
#   cp fm_naig6_custom.so $PIN_HOME/lib/
#
# Mirrors the proven fm_nai3_pol/Makefile (gcc -fPIC -shared, -I../../../include).

OS=linux
PIN_VERSION=7.5

PINDIR=../../..
INCDIR=$(PINDIR)/include

CC_linux = gcc
CC = $(CC_$(OS))

CFLAGS_linux= -fPIC
CFLAGS= $(CFLAGS_$(OS)) -DFLIST_HEAP

CPPFLAGS = -I$(INCDIR)

LDFLAGS_linux= -shared -L/usr/lib
LDFLAGS = $(LDFLAGS_$(OS))
LD = $(CC)

SL_EXT_linux= so
SL_EXT= $(SL_EXT_$(OS))

OS_LIBS_linux= -lm
OS_LIBS= $(OS_LIBS_$(OS))

INCFILES= $(INCDIR)/pcm.h \
        $(INCDIR)/pin_errs.h $(INCDIR)/pinlog.h \
        $(INCDIR)/pin_flds.h

FILES= fm_naig6_config.c \
        fm_naig6_commit_customer.c \
        fm_naig6_load_ai_usage.c \
        fm_naig6_act_rate.c

OBJECTS= fm_naig6_config.o \
        fm_naig6_commit_customer.o \
        fm_naig6_load_ai_usage.o \
        fm_naig6_act_rate.o

LIBORDER=fm_naig6_custom.$(SL_EXT)

all: $(LIBORDER)

clean:
	rm -f $(OBJECTS) core

clobber: clean
	rm -f $(LIBORDER)

$(LIBORDER): $(OBJECTS) $(INCFILES) Makefile
	$(LD) -o $(LIBORDER) $(LDFLAGS) $(OBJECTS) $(OS_LIBS)

$(OBJECTS): $(INCFILES) Makefile
	$(CC) -c $(CFLAGS) $(CPPFLAGS) $(FILES)
