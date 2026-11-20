package main

import (
	"fmt"
	"os"
	"syscall"
)

const safeOpenFlags = syscall.O_NONBLOCK | syscall.O_NOFOLLOW

func singleLink(_ *os.File, st os.FileInfo) bool {
	raw, ok := st.Sys().(*syscall.Stat_t)
	return ok && raw.Nlink == 1
}

func exactEntry(_ *os.Root, _ string, _ os.FileInfo) bool { return true }

func directoryID(dir *os.File) (string, error) {
	st, err := dir.Stat()
	if err != nil {
		return "", err
	}
	raw := st.Sys().(*syscall.Stat_t)
	return fmt.Sprintf("%d:%d", raw.Dev, raw.Ino), nil
}
