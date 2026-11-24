package main

import (
	"bytes"
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

// Resolve one directory at a time and keep the verified object open. os.Root
// alone permits symlinks whose destination is elsewhere within the same share.
func (s share) openParent(name string) (*os.Root, error) {
	current, err := s.root.OpenRoot(".")
	if err != nil {
		return nil, err
	}
	for _, part := range strings.Split(path.Dir(name), "/") {
		if part == "." {
			continue
		}
		expected, err := current.Lstat(part)
		if err != nil {
			current.Close()
			return nil, err
		}
		if !expected.IsDir() || expected.Mode()&os.ModeSymlink != 0 || !exactEntry(current, part, expected) {
			current.Close()
			return nil, changed
		}
		next, err := current.OpenRoot(part)
		current.Close()
		if err != nil {
			return nil, err
		}
		actual, err := next.Stat(".")
		if err != nil || !os.SameFile(expected, actual) {
			next.Close()
			return nil, changed
		}
		current = next
	}
	return current, nil
}

// Pin the directory itself through openParent + OpenRoot so stat/list never follow
// an intra-share symlink or swapped directory component after check().
func (s share) openDirectoryPinned(name string) (*os.Root, error) {
	if name == "." {
		return s.root.OpenRoot(".")
	}
	parent, err := s.openParent(name)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	base := path.Base(name)
	expected, err := parent.Lstat(base)
	if err != nil {
		return nil, err
	}
	if !expected.IsDir() || expected.Mode()&os.ModeSymlink != 0 || !exactEntry(parent, base, expected) {
		return nil, denied
	}
	dirRoot, err := parent.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	actual, err := dirRoot.Stat(".")
	if err != nil || !os.SameFile(expected, actual) {
		dirRoot.Close()
		return nil, changed
	}
	return dirRoot, nil
}

// Pin both containing directories under os.Root before the native operation.
func (s share) renamePinned(from, to string, overwrite bool) error {
	srcParent, err := s.openParent(from)
	if err != nil {
		return err
	}
	defer srcParent.Close()
	src, err := srcParent.Open(".")
	if err != nil {
		return err
	}
	defer src.Close()
	if path.Dir(from) == path.Dir(to) {
		return renameAt(src, path.Base(from), src, path.Base(to), overwrite)
	}
	dstParent, err := s.openParent(to)
	if err != nil {
		return err
	}
	defer dstParent.Close()
	dst, err := dstParent.Open(".")
	if err != nil {
		return err
	}
	defer dst.Close()
	return renameAt(src, path.Base(from), dst, path.Base(to), overwrite)
}

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
	Directory   bool   `json:"directory"`
	Recursive   bool   `json:"recursive"`
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
func (s share) metadata(name string, info fs.FileInfo, f *os.File) (entry, error) {
	id, err := changeIdentity(s.root, name, info, f)
	if err != nil {
		return entry{}, err
	}
	version := digest([]byte(fmt.Sprintf("v3:%s:%d:%d", id, info.Size(), info.ModTime().UnixNano())))
	return entry{Name: info.Name(), Directory: info.IsDir(), Size: info.Size(), Modified: info.ModTime().UnixMilli(), Version: version}, nil
}

func (s share) matchesVersion(name string, st os.FileInfo, f *os.File, version string) bool {
	e, err := s.metadata(name, st, f)
	return err == nil && e.Version == version
}

func (op operation) beforeWrite() error {
	if !op.deadline.IsZero() && !time.Now().Before(op.deadline) {
		return changed
	}
	return nil
}

func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func validDigest(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size && strings.ToLower(s) == s
}
func (s share) openRegular(name string, flags int) (*os.File, error) {
	parent, err := s.openParent(name)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	base := path.Base(name)
	f, err := parent.OpenFile(base, flags|safeOpenFlags, 0600)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	entry, lookup := parent.Lstat(base)
	if err != nil || lookup != nil || !st.Mode().IsRegular() || !singleLink(f, st) ||
		!os.SameFile(entry, st) || !exactEntry(parent, base, entry) {
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
	read := readOperation(op.Op)
	if !read && (!s.writable || op.Path == ".") {
		return out, denied
	}
	if !read {
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
	}
	if err := s.check(op.Path, true); err != nil && !(op.Op == "begin" && errors.Is(err, fs.ErrNotExist)) {
		return out, err
	}
	switch op.Op {
	case "stat":
		if op.Path == "." {
			info, err := s.root.Lstat(".")
			if err != nil {
				return out, err
			}
			e, err := s.metadata(".", info, nil)
			if err != nil {
				return out, err
			}
			out.Entry = &e
			break
		}
		parent, err := s.openParent(op.Path)
		if err != nil {
			return out, err
		}
		defer parent.Close()
		base := path.Base(op.Path)
		info, err := parent.Lstat(base)
		if err != nil {
			return out, err
		}
		if info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeIrregular != 0 ||
			(!info.IsDir() && !info.Mode().IsRegular()) || !exactEntry(parent, base, info) {
			return out, denied
		}
		e, err := (share{root: parent}).metadata(base, info, nil)
		if err != nil {
			return out, err
		}
		out.Entry = &e
	case "list":
		dirRoot, err := s.openDirectoryPinned(op.Path)
		if err != nil {
			return out, err
		}
		defer dirRoot.Close()
		d, err := dirRoot.Open(".")
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
			info, err := dirRoot.Lstat(item.Name())
			if err != nil {
				return out, err
			}
			if info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeIrregular != 0 ||
				(!info.IsDir() && !info.Mode().IsRegular()) || !exactEntry(dirRoot, item.Name(), info) {
				continue
			}
			bytes += len(item.Name())*6 + 200
			if bytes > 1800000 {
				return out, invalid
			}
			e, err := (share{root: dirRoot}).metadata(item.Name(), info, nil)
			if err != nil {
				return out, err
			}
			items = append(items, e)
		}
	case "checksum":
		f, err := s.openRegular(op.Path, os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || !s.matchesVersion(op.Path, st, f, op.Version) {
			return out, changed
		}
		hash := sha256.New()
		if _, err = io.Copy(hash, f); err != nil {
			return out, err
		}
		st, err = f.Stat()
		if err != nil || !s.matchesVersion(op.Path, st, f, op.Version) {
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
		if !s.matchesVersion(op.Path, st, f, op.Version) || op.Offset > st.Size()-int64(op.Length) {
			return out, changed
		}
		b := make([]byte, op.Length)
		if _, err = f.ReadAt(b, op.Offset); err != nil {
			return out, err
		}
		st, err = f.Stat()
		if err != nil || !s.matchesVersion(op.Path, st, f, op.Version) {
			return out, changed
		}
		out.Data = b
		out.Digest = digest(b)
	case "mkdir":
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		parent, err := s.openParent(op.Path)
		if err != nil {
			return out, err
		}
		defer parent.Close()
		return out, parent.Mkdir(path.Base(op.Path), 0750)
	case "delete", "rmdir":
		if op.Op == "rmdir" && !op.Directory {
			return out, changed
		}
		return out, s.removeChecked(op)
	case "copy-step":
		return s.copyStep(op)
	case "rename", "rename-exclusive", "copy":
		if op.Destination == "." || !validPath(op.Destination) {
			return out, denied
		}
		if err := s.check(op.Destination, true); err != nil {
			return out, err
		}
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		if op.Op == "rename-exclusive" {
			return out, s.renamePinned(op.Path, op.Destination, false)
		}
		if !op.Overwrite {
			if _, err := s.root.Lstat(op.Destination); !errors.Is(err, fs.ErrNotExist) {
				return out, fs.ErrExist
			}
		}
		if err := op.beforeWrite(); err != nil {
			return out, err
		}
		if op.Op == "rename" {
			return out, s.renamePinned(op.Path, op.Destination, op.Overwrite)
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
		key := digest(nonce)
		if err := s.ensureStageDir(); err != nil {
			return out, err
		}
		marker := path.Join(s.stageDir(), "plain-"+key)
		journal, err := s.openRegular(marker, os.O_EXCL|os.O_CREATE|os.O_WRONLY)
		if err != nil {
			return out, err
		}
		_, err = journal.WriteString(op.Destination)
		if err = errors.Join(err, journal.Close()); err != nil {
			return out, err
		}
		temporary := path.Join(path.Dir(op.Destination), ".vch-copy-"+key)
		parent, err := s.openParent(op.Destination)
		if err != nil {
			return out, err
		}
		defer parent.Close()
		dest, err := parent.OpenFile(path.Base(temporary), os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return out, err
		}
		defer func() {
			if parent.Remove(path.Base(temporary)) == nil {
				s.root.Remove(marker)
			}
		}()
		_, err = io.Copy(dest, src)
		defer dest.Close()
		if err != nil {
			return out, err
		}
		if op.deadline.IsZero() || !time.Now().Before(op.deadline) {
			return out, changed
		}
		// Publish the copied inode and atomically refuse a concurrent destination.
		return out, publishOpenFile(parent, dest, path.Base(temporary), path.Base(op.Destination))
	case "begin", "chunk", "publish":
		if !validDigest(op.Digest) || op.Size < 0 || op.Offset < 0 || op.Offset > op.Size {
			return out, invalid
		}
		// Separate namespaces on re-pairing. The hub can never supply a staging path.
		key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.Digest))
		tmp := path.Join(path.Dir(op.Path), ".vch-upload-"+key)
		if op.Op == "begin" {
			if err := s.ensureStageDir(); err != nil {
				return out, err
			}
			if err := op.beforeWrite(); err != nil {
				return out, err
			}
			cur, err := s.root.OpenRoot(".")
			if err != nil {
				return out, err
			}
			for _, part := range strings.Split(path.Dir(op.Path), "/") {
				if part == "." {
					continue
				}
				if err := op.beforeWrite(); err != nil {
					cur.Close()
					return out, err
				}
				if err := cur.Mkdir(part, 0750); err != nil && !errors.Is(err, fs.ErrExist) {
					cur.Close()
					return out, err
				}
				info, err := cur.Lstat(part)
				if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !exactEntry(cur, part, info) {
					cur.Close()
					return out, denied
				}
				next, err := cur.OpenRoot(part)
				cur.Close()
				if err != nil {
					return out, err
				}
				actual, err := next.Stat(".")
				if err != nil || !os.SameFile(info, actual) {
					next.Close()
					return out, changed
				}
				cur = next
			}
			cur.Close()
			if err := s.trackUpload(key, op.Path); err != nil {
				return out, err
			}
		}
		if err := s.relocateLegacyUpload(op, key, tmp); err != nil {
			return out, err
		}
		if op.Op == "begin" {
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
			if err := op.beforeWrite(); err != nil {
				return out, err
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
		parent, err := s.openParent(op.Path)
		if err != nil {
			return out, err
		}
		defer parent.Close()
		f, err := (share{root: parent}).openRegular(path.Base(tmp), os.O_RDONLY)
		if err != nil {
			return out, err
		}
		defer f.Close()
		hash := sha256.New()
		n, err := io.Copy(hash, f)
		if err != nil {
			return out, err
		}
		if n != op.Size || hex.EncodeToString(hash.Sum(nil)) != op.Digest {
			return out, changed
		}
		if err := s.publishChecked(op, parent, f, path.Base(tmp)); err != nil {
			return out, err
		}
		info, err = parent.Lstat(path.Base(op.Path))
		if err != nil {
			return out, err
		}
		e, err := (share{root: parent}).metadata(path.Base(op.Path), info, f)
		out.Entry = &e
		return out, err
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
			if err != nil || !st.Mode().IsRegular() {
				continue
			}
			if key, ok := strings.CutPrefix(e.Name(), "job-"); ok && validDigest(key) {
				s.expireJob(e.Name(), st.ModTime(), now)
			} else if key, ok := strings.CutPrefix(e.Name(), "publish-"); ok && validDigest(key) {
				s.recoverUpload(path.Join(stageDir, e.Name()), key)
			} else if key, ok := strings.CutPrefix(e.Name(), "upload-"); ok && validDigest(key) && now.Sub(st.ModTime()) > 48*time.Hour {
				s.expireUpload(path.Join(stageDir, e.Name()), key)
			} else if key, ok := strings.CutPrefix(e.Name(), "plain-"); ok && validDigest(key) {
				s.recoverPlainCopy(path.Join(stageDir, e.Name()), key, now.Sub(st.ModTime()) > 48*time.Hour)
			} else if now.Sub(st.ModTime()) > 48*time.Hour {
				name := path.Join(stageDir, e.Name())
				if validDigest(e.Name()) || strings.HasPrefix(e.Name(), "receipt-tmp-") {
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

// Capture the checked regular file under a private name and recheck it. A writer
// arriving during verification wins the no-replace link. Keep any displaced
// inode whose restoration conflicts so it can be recovered by operation ID.
func (s share) publishChecked(op operation, parent *os.Root, stage *os.File, tmp string) error {
	if op.Version == "" || op.jobID == "" || !time.Now().Before(op.deadline) {
		return changed
	}
	key := digest([]byte(s.namespace + "\x00" + op.jobID))
	marker := path.Join(s.stageDir(), "publish-"+key)
	backup := ".vch-publish-" + key
	pinned := share{root: parent}
	name := path.Base(op.Path)
	stageID, err := directoryID(stage)
	if err != nil {
		return err
	}
	record := publishIntent{Path: op.Path, Digest: op.Digest, Job: op.jobID, StageID: stageID}
	if err := s.saveIntent(marker, record); err != nil {
		return err
	}
	defer s.recoverUpload(marker, key)
	if op.Version != "absent" {
		before, err := pinned.openRegular(name, os.O_RDONLY)
		if err != nil {
			return changed
		}
		defer before.Close()
		st, err := before.Stat()
		if err != nil || !s.matchesVersion(op.Path, st, before, op.Version) {
			return changed
		}
		prior := sha256.New()
		if _, err := io.Copy(prior, before); err != nil {
			return err
		}
		st, err = before.Stat()
		if err != nil || !s.matchesVersion(op.Path, st, before, op.Version) {
			return changed
		}
		if err := op.beforeWrite(); err != nil {
			return err
		}
		if err := pinned.renamePinned(name, backup, false); err != nil {
			return err
		}
		after, err := pinned.openRegular(backup, os.O_RDONLY)
		if err != nil {
			return changed
		}
		defer after.Close()
		captured, err := after.Stat()
		if err != nil || !os.SameFile(captured, st) {
			return changed
		}
		hash := sha256.New()
		if _, err := io.Copy(hash, after); err != nil {
			return err
		}
		if !bytes.Equal(hash.Sum(nil), prior.Sum(nil)) {
			return changed
		}
	}
	if !time.Now().Before(op.deadline) {
		return changed
	}
	return publishOpenFile(parent, stage, tmp, name)
}
