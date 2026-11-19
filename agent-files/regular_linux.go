package main

import (
	"os"
	"syscall"
)

const safeOpenFlags = syscall.O_NONBLOCK | syscall.O_NOFOLLOW

func singleLink(_ *os.File, st os.FileInfo) bool {
	raw, ok := st.Sys().(*syscall.Stat_t)
	return ok && raw.Nlink == 1
}

func exactEntry(_ *os.Root, _ string, _ os.FileInfo) bool { return true }
