package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"strings"
)

// Keep a private directory at the share or child mount root. Its entries can be
// safely unlinked through a pinned directory even if a writer moves the directory
// itself. Ordinary user directories stay removable when their last file is deleted.
func (s share) deletionDirectory(parent string) (*os.Root, error) {
	base, err := s.deletionMountRoot(parent)
	if err != nil {
		return nil, err
	}
	defer base.Close()
	name := ".vch-deletions-" + digest([]byte(s.namespace))
	trusted, err := openPrivateDirectory(base, name)
	if err != nil {
		return nil, err
	}
	defer trusted.Close()
	if err := syncRoot(base); err != nil {
		return nil, err
	}
	private, err := base.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	want, err := trusted.Stat()
	actual, lookup := private.Stat(".")
	if err != nil || lookup != nil || !os.SameFile(want, actual) {
		private.Close()
		return nil, changed
	}
	return private, nil
}

// Move the target exclusively before checking which object was captured.
func (s share) removeChecked(op operation) error {
	parent, err := s.openParent(op.Path)
	if err != nil {
		return err
	}
	defer parent.Close()
	name := path.Base(op.Path)
	original, err := parent.OpenFile(name, os.O_RDONLY|safeOpenFlags, 0)
	if err != nil {
		return err
	}
	defer original.Close()
	st, err := original.Stat()
	if err != nil || st.IsDir() != op.Directory || (!st.IsDir() && (!st.Mode().IsRegular() || !singleLink(original, st))) {
		return changed
	}
	if !s.matchesVersion(op.Path, st, original, op.Version) {
		return changed
	}
	return s.quarantineAndRemove(parent, op, st)
}

func (s share) quarantineAndRemove(parent *os.Root, op operation, original os.FileInfo) error {
	name := path.Base(op.Path)
	private, err := s.deletionDirectory(path.Dir(op.Path))
	if err != nil {
		return err
	}
	defer private.Close()
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return err
	}
	key := hex.EncodeToString(nonce[:])
	entry, marker := key+".entry", key+".json"
	if err = (share{root: private}).saveIntent(marker, op.Path); err != nil {
		return err
	}
	keepIntent := false
	defer func() {
		if !keepIntent {
			if syncRoot(private) == nil {
				private.Remove(marker)
			}
		}
	}()
	src, err := parent.Open(".")
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := private.Open(".")
	if err != nil {
		return err
	}
	defer dst.Close()
	if err := op.beforeWrite(); err != nil {
		return err
	}
	if err := renameAt(src, name, dst, entry, false); err != nil {
		return err
	}
	keepIntent = true
	if err := errors.Join(syncDirectory(dst), syncDirectory(src)); err != nil {
		return err
	}
	captured, err := private.Lstat(entry)
	if err != nil || !os.SameFile(original, captured) || original.Size() != captured.Size() || !original.ModTime().Equal(captured.ModTime()) {
		err = changed
	} else if err = op.beforeWrite(); err == nil {
		if op.Op == "delete" && op.Recursive && op.Directory {
			// Only a verified recursive delete may be resumed destructively. Once
			// committed, never restore a tree that may already be partially removed.
			confirmed := key + ".confirmed"
			if err := durableRename(dst, marker, dst, confirmed, false); err != nil {
				return err
			}
			marker = confirmed
			err = removeTree(op, private, entry)
			keepIntent = err != nil
			return err
		} else {
			err = private.Remove(entry)
		}
	}
	if err != nil {
		// A concurrent creator keeps its name. The journal locates the displaced entry.
		if restore := durableRename(dst, entry, src, name, false); restore != nil {
			keepIntent = true
			return errors.Join(err, restore)
		}
	}
	keepIntent = false
	return err
}

func removeTree(op operation, parent *os.Root, name string) error {
	if err := op.beforeWrite(); err != nil {
		return err
	}
	st, err := parent.Lstat(name)
	if err != nil {
		return err
	}
	if st.IsDir() && st.Mode()&os.ModeSymlink == 0 && exactEntry(parent, name, st) {
		dir, err := parent.OpenRoot(name)
		if err != nil {
			return err
		}
		defer dir.Close()
		actual, err := dir.Stat(".")
		if err != nil || !os.SameFile(st, actual) {
			return changed
		}
		f, err := dir.Open(".")
		if err != nil {
			return err
		}
		defer f.Close()
		for {
			entries, readErr := f.ReadDir(128)
			for _, child := range entries {
				if err := removeTree(op, dir, child.Name()); err != nil {
					return err
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				return readErr
			}
		}
		f.Close()
		dir.Close()
	}
	if err := op.beforeWrite(); err != nil {
		return err
	}
	return parent.Remove(name)
}

// Called with the share's executor lock, before polling and between jobs.
// Legacy JSON and pre-verification captures can only be restored, never
// discarded. An occupied live name, malformed intent or unmarked entry stays put.
func (s share) recoverDeletions() {
	for _, mount := range s.deletionRoots() {
		name := path.Join(mount, ".vch-deletions-"+digest([]byte(s.namespace)))
		if st, err := s.root.Lstat(name); err != nil || !st.IsDir() {
			continue
		}
		private, err := s.deletionDirectory(mount)
		if err != nil {
			continue
		}
		f, err := private.Open(".")
		if err == nil {
			for {
				entries, readErr := f.ReadDir(128)
				for _, e := range entries {
					s.recoverDeletion(private, f, e.Name())
				}
				if readErr != nil {
					break
				}
			}
			f.Close()
		}
		private.Close()
	}
}

func (s share) recoverDeletion(private *os.Root, src *os.File, marker string) {
	key, ext, ok := strings.Cut(marker, ".")
	if !ok || len(key) != 32 || (ext != "json" && ext != "confirmed") {
		return
	}
	if _, err := hex.DecodeString(key); err != nil {
		return
	}
	var target string
	if !(share{root: private}).readIntent(marker, &target) || !validPath(target) || target == "." {
		return
	}
	entry := key + ".entry"
	_, err := private.Lstat(entry)
	if err == nil && ext == "confirmed" {
		err = removeTree(operation{}, private, entry)
	} else if err == nil {
		parent, lookup := s.openParent(target)
		if lookup != nil {
			return
		}
		defer parent.Close()
		dst, lookup := parent.Open(".")
		if lookup != nil {
			return
		}
		defer dst.Close()
		err = durableRename(src, entry, dst, path.Base(target), false)
	} else if errors.Is(err, os.ErrNotExist) {
		err = nil
	}
	if err == nil && syncDirectory(src) == nil {
		private.Remove(marker)
	}
}
