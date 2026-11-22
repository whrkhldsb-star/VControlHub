package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"time"
)

type publishIntent struct {
	Path, Digest, Job, StageID string
}

// Persist the complete intent before moving any public name.
func (s share) saveIntent(marker string, value any) error {
	f, err := s.openRegular(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return err
	}
	err = json.NewEncoder(f).Encode(value)
	return errors.Join(err, f.Sync(), f.Close())
}

func (s share) trackUpload(key, target string) error {
	name := path.Join(s.stageDir(), "upload-"+key)
	err := s.saveIntent(name, target)
	if errors.Is(err, fs.ErrExist) {
		return s.root.Chtimes(name, time.Now(), time.Now())
	}
	return err
}

// Keep the previous version's resumable bytes until their copy on the target
// filesystem is complete. Repeating this after an interrupted migration is safe.
func (s share) relocateLegacyUpload(op operation, key, stage string) (err error) {
	legacy := path.Join(s.stageDir(), key)
	source, err := s.openRegular(legacy, os.O_RDONLY)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, source.Close())
		if err == nil {
			err = s.root.Remove(legacy)
		}
	}()
	info, err := source.Stat()
	if err != nil {
		return err
	}
	if info.Size() > op.Size {
		return changed
	}
	if err := s.trackUpload(key, op.Path); err != nil {
		return err
	}
	dest, err := s.openRegular(stage, os.O_CREATE|os.O_RDWR)
	if err != nil {
		return err
	}
	// openRegular checked the link count before the private stage is truncated.
	if err = dest.Truncate(0); err == nil {
		_, err = io.CopyN(dest, source, info.Size())
	}
	return errors.Join(err, dest.Sync(), dest.Close())
}

func (s share) readIntent(marker string, value any) bool {
	f, err := s.openRegular(marker, os.O_RDONLY)
	if err != nil {
		return false
	}
	defer f.Close()
	return json.NewDecoder(io.LimitReader(f, 16384)).Decode(value) == nil
}

func (s share) expireUpload(marker, key string) {
	var target string
	if !s.readIntent(marker, &target) || !validPath(target) || s.check(path.Dir(target), false) != nil {
		return
	}
	tmp := path.Join(path.Dir(target), ".vch-upload-"+key)
	info, err := s.root.Lstat(tmp)
	if err == nil && info.Mode().IsRegular() && time.Since(info.ModTime()) < 48*time.Hour {
		return
	}
	if err := s.root.Remove(tmp); err == nil || errors.Is(err, fs.ErrNotExist) {
		s.root.Remove(marker)
	}
}

// Reconstruct the phase from the recorded inode and names. A competing
// writer keeps its name; retain the displaced original when rollback conflicts.
func (s share) recoverUpload(marker, key string) {
	var rec publishIntent
	if !s.readIntent(marker, &rec) || !validPath(rec.Path) || rec.Path == "." || !validDigest(rec.Digest) ||
		digest([]byte(s.namespace+"\x00"+rec.Job)) != key || s.check(path.Dir(rec.Path), false) != nil {
		return
	}
	parent, err := s.openParent(rec.Path)
	if err != nil {
		return
	}
	defer parent.Close()
	pinned := share{root: parent}
	name := path.Base(rec.Path)
	upload := digest([]byte(s.namespace + "\x00" + rec.Path + "\x00" + rec.Digest))
	tmp := ".vch-upload-" + upload
	backup := ".vch-publish-" + key
	public, err := parent.Lstat(name)
	missing := errors.Is(err, fs.ErrNotExist)
	if err != nil && !missing {
		return
	}
	if !missing && public.Mode().IsRegular() {
		f, err := parent.OpenFile(name, os.O_RDONLY|safeOpenFlags, 0)
		if err != nil {
			return
		}
		id, err := directoryID(f)
		f.Close()
		if err == nil && id == rec.StageID {
			stage, err := parent.Lstat(tmp)
			if err == nil && os.SameFile(stage, public) {
				err = parent.Remove(tmp)
			}
			if err != nil && !errors.Is(err, fs.ErrNotExist) {
				return
			}
			if err := parent.Remove(backup); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return
			}
			s.root.Remove(path.Join(s.stageDir(), "upload-"+upload))
			s.root.Remove(marker)
			return
		}
	}
	if _, err := parent.Lstat(backup); err == nil {
		if !missing || pinned.renamePinned(backup, name, false) != nil {
			return
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return
	}
	s.root.Remove(marker)
}
