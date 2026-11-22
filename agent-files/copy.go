package main

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
)

// Record the parent before creating either artifact. Keeping the files beside the
// destination also permits atomic publication on mounts below the share root.
func (s share) trackCopy(key, parent string) error {
	if err := s.ensureStageDir(); err != nil {
		return err
	}
	f, err := s.openRegular(path.Join(s.stageDir(), "copy-"+key), os.O_CREATE|os.O_WRONLY)
	if err != nil {
		return err
	}
	// Rewriting the same parent refreshes the lease even when the backed-up
	// file's own modification time is years old.
	_, err = f.WriteString(parent)
	return errors.Join(err, f.Close())
}

func (s share) cleanupCopy(marker, key string) {
	f, err := s.openRegular(marker, os.O_RDONLY)
	if err != nil {
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, 2001))
	f.Close()
	parent := string(data)
	if err != nil || !validPath(parent) {
		return
	}
	if err := s.check(parent, false); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return
	}
	// Only the hub knows whether its index committed. Keep both the original
	// and its locator until an explicit restore or drop-backup succeeds.
	if _, err := s.root.Lstat(path.Join(parent, ".vch-backup-"+key)); !errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err := s.root.Remove(path.Join(parent, ".vch-copy-"+key)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return
	}
	s.root.Remove(marker)
}

// A crash between link and unlink leaves the published inode unreadable until
// its private alias is removed. Only unlink an alias of the recorded target.
func (s share) recoverPlainCopy(marker, key string, stale bool) {
	f, err := s.openRegular(marker, os.O_RDONLY)
	if err != nil {
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, 2001))
	f.Close()
	target := string(data)
	if err != nil || !validPath(target) || target == "." || s.check(path.Dir(target), false) != nil {
		return
	}
	stage := path.Join(path.Dir(target), ".vch-copy-"+key)
	tmp, err := s.root.Lstat(stage)
	if errors.Is(err, fs.ErrNotExist) && stale {
		s.root.Remove(marker)
		return
	}
	if err != nil || !tmp.Mode().IsRegular() {
		return
	}
	dst, err := s.root.Lstat(target)
	if err == nil && dst.Mode().IsRegular() && os.SameFile(tmp, dst) {
		if s.root.Remove(stage) == nil {
			s.root.Remove(marker)
		}
	} else if stale {
		// A private, single-link staging file never reached publication.
		f, err := s.openRegular(stage, os.O_RDONLY)
		if err == nil {
			f.Close()
			if s.root.Remove(stage) == nil {
				s.root.Remove(marker)
			}
		}
	}
}

// The hub supplies an operation ID and ordinary paths. Only the Agent names its
// staging and rollback files. Keep both beside the target for same-volume publication.
func (s share) copyStep(op operation) (result, error) {
	var out result
	if !validDigest(op.CopyID) {
		return out, invalid
	}
	key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.CopyID))
	parent, err := s.openParent(op.Path)
	if err != nil {
		return out, err
	}
	defer parent.Close()
	pinned := share{root: parent}
	name := path.Base(op.Path)
	stage := ".vch-copy-" + key
	backup := ".vch-backup-" + key
	if op.Step == "stage" || op.Step == "backup" {
		if err := s.trackCopy(key, path.Dir(op.Path)); err != nil {
			return out, err
		}
	}
	switch op.Step {
	case "stage":
		if err := s.check(op.Destination, false); err != nil {
			return out, err
		}
		src, err := s.openRegular(op.Destination, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer src.Close()
		dest, err := parent.OpenFile(stage, os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return out, err
		}
		out.Offset, err = io.Copy(dest, src)
		return out, errors.Join(err, dest.Close())
	case "backup":
		f, err := pinned.openRegular(name, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		f.Close()
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		return out, pinned.renamePinned(name, backup, false)
	case "promote", "restore":
		from := stage
		if op.Step == "restore" {
			from = backup
		}
		f, err := pinned.openRegular(from, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			return out, err
		}
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		if err := publishOpenFile(parent, f, from, name); err != nil {
			return out, err
		}
		alias, err := parent.Lstat(from)
		if err != nil || !os.SameFile(alias, info) {
			return out, changed
		}
		if err := parent.Remove(from); err != nil {
			return out, err
		}
		published, err := parent.Lstat(name)
		if err != nil || !os.SameFile(info, published) {
			return out, changed
		}
		entry, err := pinned.metadata(name, published, f)
		out.Entry = &entry
		return out, err
	case "rollback":
		err := s.removeChecked(op)
		if errors.Is(err, fs.ErrNotExist) {
			err = nil
		}
		return out, err
	case "has-backup":
		info, err := parent.Lstat(backup)
		if errors.Is(err, fs.ErrNotExist) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		if !info.Mode().IsRegular() {
			return out, denied
		}
		out.Offset = 1
		return out, nil
	case "drop-stage", "drop-backup":
		from := stage
		if op.Step == "drop-backup" {
			from = backup
		}
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		err := parent.Remove(from)
		if errors.Is(err, fs.ErrNotExist) {
			err = nil
		}
		return out, err
	default:
		return out, invalid
	}
}
