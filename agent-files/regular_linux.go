package main

import (
	"errors"
	"fmt"
	"os"
	"path"
	"syscall"

	"golang.org/x/sys/unix"
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

func renameAtExclusive(src *os.File, from string, dst *os.File, to string) error {
	err := unix.Renameat2(int(src.Fd()), from, int(dst.Fd()), to, unix.RENAME_NOREPLACE)
	if err == unix.ENOSYS || err == unix.EOPNOTSUPP || err == unix.EINVAL {
		return invalid
	}
	return err
}

func changeIdentity(_ *os.Root, _ string, st os.FileInfo, _ *os.File) (string, error) {
	raw := st.Sys().(*syscall.Stat_t)
	return fmt.Sprintf("%x:%x:%x:%x", raw.Dev, raw.Ino, raw.Ctim.Sec, raw.Ctim.Nsec), nil
}

func lockExecutor(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

// Use the kernel mount ID when available so bind mounts of the same device
// get a separate staging area. Rename itself fails closed across mount points.
func mountID(dir *os.File) (uint64, error) {
	var stx unix.Statx_t
	if err := unix.Statx(int(dir.Fd()), "", unix.AT_EMPTY_PATH, unix.STATX_MNT_ID, &stx); err == nil && stx.Mask&unix.STATX_MNT_ID != 0 {
		return stx.Mnt_id, nil
	}
	var st unix.Stat_t
	err := unix.Fstat(int(dir.Fd()), &st)
	return uint64(st.Dev), err
}

func (s share) deletionMountRoot(parent string) (*os.Root, error) {
	dir, err := s.root.Open(parent)
	if err != nil {
		return nil, err
	}
	id, err := mountID(dir)
	dir.Close()
	if err != nil {
		return nil, err
	}
	for parent != "." {
		next := path.Dir(parent)
		f, err := s.root.Open(next)
		if err != nil {
			return nil, err
		}
		ancestor, err := mountID(f)
		f.Close()
		if err != nil {
			return nil, err
		}
		if id != ancestor {
			break
		}
		parent = next
	}
	return s.root.OpenRoot(parent)
}

func openPrivateDirectory(parent *os.Root, name string) (*os.File, error) {
	if err := parent.Mkdir(name, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	f, err := parent.OpenFile(name, unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		f.Close()
		return nil, denied
	}
	return f, nil
}
