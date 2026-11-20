package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

const chunkSize = 1024 * 1024

func (s share) stageDir() string { return ".vch-transfers-" + digest([]byte(s.namespace)) }

func (s share) ensureStageDir() error {
	dir := s.stageDir()
	if err := s.root.Mkdir(dir, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	info, err := s.root.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !exactEntry(s.root, dir, info) {
		return denied
	}
	return nil
}

type operation struct {
	deadline    time.Time
	jobID       string
	Op          string `json:"op"`
	CopyID      string `json:"copyId"`
	Step        string `json:"step"`
	Path        string `json:"path"`
	Destination string `json:"destination"`
	Offset      int64  `json:"offset"`
	Size        int64  `json:"size"`
	Length      int    `json:"length"`
	Digest      string `json:"digest"`
	ChunkDigest string `json:"chunkDigest"`
	Version     string `json:"version"`
	Data        []byte `json:"data"`
	Overwrite   bool   `json:"overwrite"`
}
type entry struct {
	Name      string `json:"name"`
	Directory bool   `json:"isDirectory"`
	Size      int64  `json:"size"`
	Modified  int64  `json:"lastModifiedMs"`
	Version   string `json:"etag"`
}
type result struct {
	Error   string   `json:"error,omitempty"`
	Entry   *entry   `json:"entry,omitempty"`
	Entries *[]entry `json:"entries,omitempty"`
	Offset  int64    `json:"offset"`
	Data    []byte   `json:"data,omitempty"`
	Digest  string   `json:"digest,omitempty"`
}
type share struct {
	root      *os.Root
	writable  bool
	namespace string
}

var denied = errors.New("denied")
var invalid = errors.New("invalid")
var changed = errors.New("changed")

func validPath(name string) bool {
	if name == "." {
		return true
	}
	if !fs.ValidPath(name) || !filepath.IsLocal(filepath.FromSlash(name)) || strings.ContainsAny(name, "\\:*?\"<>|") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(strings.ToLower(part), ".vch-") || strings.HasSuffix(part, ".") || strings.TrimSpace(part) != part || len(part) > 255 {
			return false
		}
		for _, c := range part {
			if c < 32 || c == 127 {
				return false
			}
		}
	}
	return len(name) <= 2000
}
func (s share) check(name string, allowMissing bool) error {
	if !validPath(name) {
		return denied
	}
	prefix := "."
	for _, part := range strings.Split(name, "/") {
		prefix = path.Join(prefix, part)
		info, err := s.root.Lstat(prefix)
		if allowMissing && prefix == name && errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if !exactEntry(s.root, prefix, info) || (!info.IsDir() && !info.Mode().IsRegular()) || info.Mode()&os.ModeIrregular != 0 {
			return denied
		}
	}
	return nil
}
func metadata(info fs.FileInfo) entry {
	return entry{Name: info.Name(), Directory: info.IsDir(), Size: info.Size(), Modified: info.ModTime().UnixMilli(), Version: fmt.Sprintf("%x-%x", info.Size(), info.ModTime().UnixNano())}
}
func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func validDigest(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size && strings.ToLower(s) == s
}
func (s share) openRegular(name string, flags int) (*os.File, error) {
	f, err := s.root.OpenFile(name, flags|safeOpenFlags, 0600)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || !singleLink(f, st) {
		f.Close()
		return nil, denied
	}
	return f, nil
}
func (s share) handle(op operation) (result, error) {
	var out result
	if op.Path == "" {
		op.Path = "."
	}
	if !validPath(op.Path) {
		return out, denied
	}
	read := op.Op == "list" || op.Op == "stat" || op.Op == "read" || op.Op == "checksum"
	if !read && (!s.writable || op.Path == ".") {
		return out, denied
	}
	if err := s.check(op.Path, true); err != nil && !(op.Op == "begin" && errors.Is(err, fs.ErrNotExist)) {
		return out, err
	}
	switch op.Op {
	case "stat":
		info, err := s.root.Lstat(op.Path)
		if err != nil {
			return out, err
		}
		e := metadata(info)
		out.Entry = &e
	case "list":
		d, err := s.root.Open(op.Path)
		if err != nil {
			return out, err
		}
		defer d.Close()
		// Bound both the number of entries and the encoded response. Never truncate an inventory.
		names, err := d.ReadDir(8193)
		if err != nil && err != io.EOF {
			return out, err
		}
		if len(names) > 8192 {
			return out, invalid
		}
		items := make([]entry, 0, len(names))
		out.Entries = &items
		bytes := 0
		for _, item := range names {
			if !validPath(item.Name()) || item.Type()&os.ModeSymlink != 0 {
				continue
			}
			info, err := item.Info()
			if err != nil {
				return out, err
			}
			if !info.IsDir() && !info.Mode().IsRegular() {
				continue
			}
			bytes += len(item.Name())*6 + 200
			if bytes > 1800000 {
				return out, invalid
			}
			items = append(items, metadata(info))
		}
	case "checksum":
		f, err := s.openRegular(op.Path, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || metadata(st).Version != op.Version {
			return out, changed
		}
		hash := sha256.New()
		if _, err = io.Copy(hash, f); err != nil {
			return out, err
		}
		st, err = f.Stat()
		if err != nil || metadata(st).Version != op.Version {
			return out, changed
		}
		out.Digest = hex.EncodeToString(hash.Sum(nil))
	case "read":
		if op.Offset < 0 || op.Length < 1 || op.Length > chunkSize {
			return out, invalid
		}
		f, err := s.openRegular(op.Path, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			return out, err
		}
		if metadata(st).Version != op.Version || op.Offset > st.Size()-int64(op.Length) {
			return out, changed
		}
		b := make([]byte, op.Length)
		if _, err = f.ReadAt(b, op.Offset); err != nil {
			return out, err
		}
		st, err = f.Stat()
		if err != nil || metadata(st).Version != op.Version {
			return out, changed
		}
		out.Data = b
		out.Digest = digest(b)
	case "mkdir":
		return out, s.root.Mkdir(op.Path, 0750)
	case "delete":
		return out, s.root.RemoveAll(op.Path)
	case "copy-step":
		return s.copyStep(op)
	case "rename", "copy":
		if op.Destination == "." || !validPath(op.Destination) {
			return out, denied
		}
		if err := s.check(op.Destination, true); err != nil {
			return out, err
		}
		if !op.Overwrite {
			if _, err := s.root.Lstat(op.Destination); !errors.Is(err, fs.ErrNotExist) {
				return out, fs.ErrExist
			}
		}
		if op.Op == "rename" {
			return out, s.root.Rename(op.Path, op.Destination)
		}
		src, err := s.openRegular(op.Path, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer src.Close()
		nonce := make([]byte, 16)
		if _, err := rand.Read(nonce); err != nil {
			return out, err
		}
		temporary := path.Join(path.Dir(op.Destination), ".vch-copy-"+hex.EncodeToString(nonce))
		dest, err := s.root.OpenFile(temporary, os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return out, err
		}
		defer s.root.Remove(temporary)
		_, err = io.Copy(dest, src)
		closeErr := dest.Close()
		if err != nil || closeErr != nil {
			return out, errors.Join(err, closeErr)
		}
		// Link publishes a fully closed file and atomically refuses a concurrent destination.
		return out, s.root.Link(temporary, op.Destination)
	case "begin", "chunk", "publish":
		if !validDigest(op.Digest) || op.Size < 0 || op.Offset < 0 || op.Offset > op.Size {
			return out, invalid
		}
		// Separate namespaces on re-pairing. The hub can never supply a staging path.
		key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.Digest))
		stageDir := s.stageDir()
		tmp := stageDir + "/" + key
		if op.Op == "begin" {
			if err := s.ensureStageDir(); err != nil {
				return out, err
			}
			if err := s.root.MkdirAll(path.Dir(op.Path), 0750); err != nil {
				return out, err
			}
			f, err := s.openRegular(tmp, os.O_RDWR|os.O_CREATE)
			if err != nil {
				return out, err
			}
			defer f.Close()
			st, err := f.Stat()
			if err != nil {
				return out, err
			}
			out.Offset = st.Size()
			if out.Offset > op.Size {
				return out, changed
			}
			return out, nil
		}
		info, err := s.root.Lstat(tmp)
		if err != nil || !info.Mode().IsRegular() {
			return out, changed
		}
		if op.Op == "chunk" {
			if len(op.Data) == 0 || len(op.Data) > chunkSize || int64(len(op.Data)) > op.Size-op.Offset || digest(op.Data) != op.ChunkDigest {
				return out, invalid
			}
			f, err := s.openRegular(tmp, os.O_RDWR)
			if err != nil {
				return out, err
			}
			defer f.Close()
			st, err := f.Stat()
			if err != nil {
				return out, err
			}
			if st.Size() != op.Offset {
				return out, changed
			}
			if _, err = f.WriteAt(op.Data, op.Offset); err != nil {
				return out, err
			}
			if err = f.Sync(); err != nil {
				return out, err
			}
			out.Offset = op.Offset + int64(len(op.Data))
			return out, nil
		}
		f, err := s.openRegular(tmp, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		hash := sha256.New()
		n, err := io.Copy(hash, f)
		f.Close()
		if err != nil {
			return out, err
		}
		if n != op.Size || hex.EncodeToString(hash.Sum(nil)) != op.Digest {
			s.root.Remove(tmp)
			return out, changed
		}
		e := metadata(info)
		e.Name = path.Base(op.Path)
		out.Entry = &e
		return out, s.publishChecked(op, tmp)
	default:
		return out, invalid
	}
	return out, nil
}
func (s share) cleanup(now time.Time) {
	stageDir := s.stageDir()
	info, err := s.root.Lstat(stageDir)
	if err != nil || !info.IsDir() {
		return
	}
	d, err := s.root.Open(stageDir)
	if err != nil {
		return
	}
	defer d.Close()
	for {
		entries, err := d.ReadDir(128)
		for _, e := range entries {
			st, err := e.Info()
			if err == nil && st.Mode().IsRegular() && now.Sub(st.ModTime()) > 48*time.Hour {
				name := path.Join(stageDir, e.Name())
				if validDigest(e.Name()) {
					s.root.Remove(name)
				} else if key, ok := strings.CutPrefix(e.Name(), "copy-"); ok && validDigest(key) {
					s.cleanupCopy(name, key)
				}
			}
		}
		if err != nil {
			return
		}
	}
}

// Capture the old inode under a private name before inspecting it. A writer
// arriving during verification wins the no-replace link. Keep any displaced
// inode whose restoration conflicts so it can be recovered by operation ID.
func (s share) publishChecked(op operation, tmp string) error {
	if op.Version == "" || op.jobID == "" || !time.Now().Before(op.deadline) {
		return changed
	}
	backup := path.Join(path.Dir(op.Path), ".vch-publish-"+digest([]byte(s.namespace+"\x00"+op.jobID)))
	if op.Version != "absent" {
		if _, err := s.root.Lstat(backup); !errors.Is(err, fs.ErrNotExist) {
			return changed
		}
		if err := s.root.Rename(op.Path, backup); err != nil {
			return err
		}
	}
	restore := func() {
		if op.Version != "absent" && s.root.Link(backup, op.Path) == nil {
			s.root.Remove(backup)
		}
	}
	if op.Version != "absent" {
		st, err := s.root.Lstat(backup)
		if err != nil || !st.Mode().IsRegular() || metadata(st).Version != op.Version {
			restore()
			return changed
		}
	}
	if !time.Now().Before(op.deadline) {
		restore()
		return changed
	}
	if err := s.root.Link(tmp, op.Path); err != nil {
		restore()
		return err
	}
	if err := s.root.Remove(tmp); err != nil {
		return err
	}
	if op.Version != "absent" {
		return s.root.Remove(backup)
	}
	return nil
}
