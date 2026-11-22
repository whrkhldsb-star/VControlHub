package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path"
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
			private.Remove(marker)
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
	captured, err := private.Lstat(entry)
	if err != nil || !os.SameFile(original, captured) || original.Size() != captured.Size() || !original.ModTime().Equal(captured.ModTime()) {
		err = changed
	} else if err = op.beforeWrite(); err == nil {
		if op.Op == "delete" && op.Recursive && op.Directory {
			err = private.RemoveAll(entry)
		} else {
			err = private.Remove(entry)
		}
	}
	if err != nil {
		// A concurrent creator keeps its name. The journal locates the displaced entry.
		if restore := renameAt(dst, entry, src, name, false); restore != nil {
			keepIntent = true
			return errors.Join(err, restore)
		}
	}
	return err
}
