package main

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
)

// The hub supplies an operation ID and ordinary paths. Only the Agent names its
// staging and rollback files. Keep both beside the target for same-volume publication.
func (s share) copyStep(op operation) (result, error) {
	var out result
	if !validDigest(op.CopyID) {
		return out, invalid
	}
	key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.CopyID))
	stage := path.Join(path.Dir(op.Path), ".vch-copy-"+key)
	backup := path.Join(path.Dir(op.Path), ".vch-backup-"+key)
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
		dest, err := s.root.OpenFile(stage, os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return out, err
		}
		out.Offset, err = io.Copy(dest, src)
		return out, errors.Join(err, dest.Close())
	case "backup":
		f, err := s.openRegular(op.Path, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		f.Close()
		return out, s.root.Rename(op.Path, backup)
	case "promote", "restore":
		from := stage
		if op.Step == "restore" {
			from = backup
		}
		f, err := s.openRegular(from, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		info, err := f.Stat()
		f.Close()
		if err != nil {
			return out, err
		}
		entry := metadata(info)
		entry.Name = path.Base(op.Path)
		out.Entry = &entry
		// Link atomically refuses a target created by another writer.
		if err := s.root.Link(from, op.Path); err != nil {
			return out, err
		}
		return out, s.root.Remove(from)
	case "rollback":
		f, err := s.openRegular(op.Path, os.O_RDONLY)
		if errors.Is(err, fs.ErrNotExist) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		info, err := f.Stat()
		f.Close()
		if err != nil {
			return out, err
		}
		if metadata(info).Version != op.Version {
			return out, changed
		}
		return out, s.root.Remove(op.Path)
	case "has-backup":
		info, err := s.root.Lstat(backup)
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
		err := s.root.Remove(from)
		if errors.Is(err, fs.ErrNotExist) {
			err = nil
		}
		return out, err
	default:
		return out, invalid
	}
}
