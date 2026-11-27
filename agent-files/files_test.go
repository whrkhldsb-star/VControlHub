package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOutboundPollAndReceipt(t *testing.T) {
	const rootID = "test-shared-directory"
	const credential = "test-only-file-credential"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/api/agent/v1/files" || r.Header.Get("Authorization") != "Bearer "+credential {
			http.Error(w, "invalid poll", http.StatusUnauthorized)
			return
		}
		var body struct {
			RootIdentity    string
			Writable        bool
			DeliveryVersion int
			Receipt         *receipt
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RootIdentity != rootID || body.Writable || body.DeliveryVersion != 2 {
			http.Error(w, "invalid directory", http.StatusBadRequest)
			return
		}
		if body.Receipt == nil {
			json.NewEncoder(w).Encode(response{Job: &work{ID: "job1", Operation: operation{Op: "stat", Path: "backup"}}})
		} else if body.Receipt.ID == "job1" && body.Receipt.Result.Error == "missing" {
			json.NewEncoder(w).Encode(response{})
		} else {
			http.Error(w, "invalid receipt", http.StatusBadRequest)
		}
	}))
	defer server.Close()
	endpoint := server.URL + "/api/agent/v1/files"
	reply, err := poll(context.Background(), server.Client(), endpoint, credential, rootID, false, nil)
	if err != nil || reply.Job == nil || reply.Job.Operation.Path != "backup" {
		t.Fatal("missing file request", err)
	}
	reply, err = poll(context.Background(), server.Client(), endpoint, credential, rootID, false, &receipt{ID: reply.Job.ID, Result: result{Error: "missing"}})
	if err != nil || reply.Job != nil {
		t.Fatal("unacknowledged file receipt", err)
	}
}

func TestResumeAndVerifyBackup(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "fixture"}
	data := make([]byte, 8*chunkSize+17)
	if _, err = rand.Read(data); err != nil {
		t.Fatal(err)
	}
	op := operation{Op: "begin", Path: "nightly/db  backup.tar", Size: int64(len(data)), Digest: digest(data)}
	run := func(op operation) result {
		t.Helper()
		if op.deadline.IsZero() {
			op.deadline = time.Now().Add(time.Minute)
		}
		r, err := s.handle(op)
		if err != nil {
			t.Fatalf("%s: %v", op.Op, err)
		}
		return r
	}
	if run(op).Offset != 0 {
		t.Fatal("initial offset")
	}
	for pos := 0; pos < len(data); {
		end := min(pos+chunkSize, len(data))
		part := op
		part.Op = "chunk"
		part.Offset = int64(pos)
		part.Data = data[pos:end]
		part.ChunkDigest = digest(part.Data)
		if pos == 0 {
			bad := part
			bad.ChunkDigest = digest(nil)
			if _, err = s.handle(bad); err == nil {
				t.Fatal("bad chunk accepted")
			}
		}
		if run(part).Offset != int64(end) {
			t.Fatal("chunk boundary")
		}
		pos = end
		if pos == chunkSize*3 {
			// A new process has no in-memory transfer state.
			root2, err := os.OpenRoot(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer root2.Close()
			s.root = root2
			if resume := run(op); resume.Offset != int64(pos) {
				t.Fatal("resume did not retain acknowledged bytes")
			}
			if _, err = os.Stat(filepath.Join(dir, filepath.FromSlash(op.Path))); !errors.Is(err, fs.ErrNotExist) {
				t.Fatal("incomplete file visible")
			}
		}
	}
	op.Op = "publish"
	op.Version, op.jobID, op.deadline = "absent", "publish-fixture", time.Now().Add(time.Minute)
	run(op)
	meta := run(operation{Op: "stat", Path: op.Path}).Entry
	full := run(operation{Op: "checksum", Path: op.Path, Version: meta.Version})
	if full.Digest != digest(data) {
		t.Fatal("published digest")
	}
	tail := run(operation{Op: "read", Path: op.Path, Version: meta.Version, Offset: chunkSize - 3, Length: 17})
	if tail.Digest != digest(tail.Data) || !bytes.Equal(tail.Data, data[chunkSize-3:chunkSize+14]) {
		t.Fatal("range mismatch")
	}
	run(operation{Op: "copy", Path: op.Path, Destination: "copy.tar"})
	if _, err = s.handle(operation{Op: "copy", Path: op.Path, Destination: "copy.tar"}); err == nil {
		t.Fatal("existing copy replaced")
	}
	run(operation{Op: "rename", Path: "copy.tar", Destination: "moved.tar"})
	run(operation{Op: "delete", Path: "moved.tar", Version: run(operation{Op: "stat", Path: "moved.tar"}).Entry.Version})
	list := run(operation{Op: "list", Path: "nightly"})
	if list.Entries == nil || len(*list.Entries) != 1 {
		t.Fatal("directory listing")
	}
	bad := operation{Op: "begin", Path: op.Path, Size: 1, Digest: digest([]byte{1})}
	run(bad)
	bad.Op = "chunk"
	bad.Data = []byte{2}
	bad.ChunkDigest = digest(bad.Data)
	run(bad)
	bad.Op = "publish"
	if _, err = s.handle(bad); err == nil {
		t.Fatal("bad file published")
	}
	if actual, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(op.Path))); err != nil || !bytes.Equal(actual, data) {
		t.Fatal("previous backup changed")
	}
}
func TestDirectoryPermissions(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root}
	for _, name := range []string{"../elsewhere", "/absolute", "a\\b", "a:stream", ".vch-transfers/state"} {
		if _, err := s.handle(operation{Op: "stat", Path: name}); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	for _, op := range []string{"begin", "chunk", "publish", "delete", "mkdir", "rename", "copy"} {
		if _, err := s.handle(operation{Op: op, Path: "report"}); !errors.Is(err, denied) {
			t.Errorf("read-only accepted %s", op)
		}
	}
	outside := filepath.Join(t.TempDir(), "original")
	if err := os.WriteFile(outside, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(outside, filepath.Join(dir, "alias")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.handle(operation{Op: "checksum", Path: "alias"}); !errors.Is(err, denied) {
		t.Fatal("hard link opened", err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "linked")); err == nil {
		if _, err = s.handle(operation{Op: "stat", Path: "linked"}); err == nil {
			t.Fatal("symbolic link followed")
		}
	}
}

func TestCopyRollbackKeepsChangedTargetAndOriginalBackup(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for name, body := range map[string]string{"draft": "new", "current": "old"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := share{root: root, writable: true, namespace: "copy fixture"}
	op := operation{Op: "copy-step", CopyID: digest([]byte("test operation")), Path: "current", Destination: "draft"}
	do := func(step string) result {
		t.Helper()
		op.Step = step
		out, err := s.handle(op)
		if err != nil {
			t.Fatal(step, err)
		}
		return out
	}
	if do("stage").Offset != 3 {
		t.Fatal("copy size")
	}
	do("backup")
	op.Version = do("promote").Entry.Version
	if err := os.WriteFile(filepath.Join(dir, "current"), []byte("edited locally"), 0600); err != nil {
		t.Fatal(err)
	}
	op.Step = "rollback"
	if _, err = s.handle(op); !errors.Is(err, changed) {
		t.Fatalf("unexpected rollback result: %v", err)
	}
	if do("has-backup").Offset != 1 {
		t.Fatal("lost original backup")
	}
	got, err := os.ReadFile(filepath.Join(dir, "current"))
	if err != nil || string(got) != "edited locally" {
		t.Fatal("lost edited destination")
	}
	if err := os.Remove(filepath.Join(dir, "current")); err != nil {
		t.Fatal(err)
	}
	do("restore")
	got, err = os.ReadFile(filepath.Join(dir, "current"))
	if err != nil || string(got) != "old" {
		t.Fatal("restore did not recover original file")
	}
}

func TestPublishAndDeletePreserveNonemptyDirectory(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "fixture"}
	if err := root.Mkdir("folder", 0700); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile("folder/other", []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	dir, err := root.Stat("folder")
	if err != nil {
		t.Fatal(err)
	}
	op := operation{Op: "begin", Path: "folder", Digest: digest(nil)}
	if _, err := s.handle(op); err != nil {
		t.Fatal(err)
	}
	current, err := s.metadata("folder", dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	op.Op, op.Version, op.jobID, op.deadline = "publish", current.Version, "job", time.Now().Add(time.Minute)
	if _, err := s.handle(op); !errors.Is(err, changed) {
		t.Fatalf("publish accepted directory: %v", err)
	}
	for _, method := range []string{"delete", "rmdir"} {
		if _, err := s.handle(operation{Op: method, Path: "folder", Directory: true, Version: op.Version}); err == nil {
			t.Fatalf("%s accepted a nonempty directory", method)
		}
	}
	if contents, err := root.ReadFile("folder/other"); err != nil || string(contents) != "keep" {
		t.Fatalf("lost batch-external file: %q, %v", contents, err)
	}
	if err := root.Remove("folder/other"); err != nil {
		t.Fatal(err)
	}
	dir, err = root.Stat("folder")
	if err != nil {
		t.Fatal(err)
	}
	current, err = s.metadata("folder", dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.handle(operation{Op: "rmdir", Path: "folder", Directory: true, Version: current.Version}); err != nil {
		t.Fatal(err)
	}
}

func TestExclusiveRenameKeepsBothFilesAtOccupiedDestination(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true}
	for _, name := range []string{"source", "unindexed"} {
		if err := root.WriteFile(name, []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.handle(operation{Op: "rename-exclusive", Path: "source", Destination: "unindexed"}); !errors.Is(err, fs.ErrExist) {
		t.Fatal(err)
	}
	for _, name := range []string{"source", "unindexed"} {
		body, err := root.ReadFile(name)
		if err != nil || string(body) != name {
			t.Fatal(name, string(body), err)
		}
	}
}

func TestLegacyUploadResumesInTheDestinationDirectory(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "test"}
	if err := s.ensureStageDir(); err != nil {
		t.Fatal(err)
	}
	data := []byte("resumed upload")
	op := operation{Op: "begin", Path: "mounted/final", Size: int64(len(data)), Digest: digest(data)}
	key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.Digest))
	legacy := s.stageDir() + "/" + key
	if err := root.WriteFile(legacy, data[:7], 0600); err != nil {
		t.Fatal(err)
	}
	if err := root.Mkdir("mounted", 0700); err != nil {
		t.Fatal(err)
	}
	// A crash left an incomplete private copy, while the original survived.
	if err := root.WriteFile("mounted/.vch-upload-"+key, data[:2], 0600); err != nil {
		t.Fatal(err)
	}
	begin, err := s.handle(op)
	if err != nil || begin.Offset != 7 {
		t.Fatal("resume offset", begin.Offset, err)
	}
	if _, err := root.Lstat(legacy); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("old stage still present", err)
	}
	op.Op, op.Offset, op.Data = "chunk", begin.Offset, data[begin.Offset:]
	op.ChunkDigest = digest(op.Data)
	if _, err := s.handle(op); err != nil {
		t.Fatal(err)
	}
	op.Op, op.Version, op.jobID, op.deadline = "publish", "absent", "resume", time.Now().Add(time.Minute)
	if _, err := s.handle(op); err != nil {
		t.Fatal(err)
	}
	if result, err := root.ReadFile(op.Path); err != nil || string(result) != string(data) {
		t.Fatal(string(result), err)
	}
}

func TestInterruptedUploadPublication(t *testing.T) {
	for _, published := range []bool{false, true} {
		t.Run(map[bool]string{true: "linked", false: "old displaced"}[published], func(t *testing.T) {
			root, err := os.OpenRoot(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			s := share{root: root, writable: true, namespace: "test"}
			const target = "volume/report"
			data := []byte("complete upload")
			op := operation{Op: "begin", Path: target, Digest: digest(data), Size: int64(len(data))}
			if _, err := s.handle(op); err != nil {
				t.Fatal(err)
			}
			op.Op, op.Data, op.ChunkDigest = "chunk", data, op.Digest
			if _, err := s.handle(op); err != nil {
				t.Fatal(err)
			}
			upload := digest([]byte(s.namespace + "\x00" + target + "\x00" + op.Digest))
			tmp := "volume/.vch-upload-" + upload
			file, err := s.openRegular(tmp, os.O_RDONLY)
			if err != nil {
				t.Fatal("stage must share the target directory", err)
			}
			id, err := directoryID(file)
			file.Close()
			if err != nil {
				t.Fatal(err)
			}
			key := digest([]byte(s.namespace + "\x00publish-job"))
			marker := s.stageDir() + "/publish-" + key
			backup := "volume/.vch-publish-" + key
			if err := root.WriteFile(target, []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := s.saveIntent(marker, publishIntent{Path: target, Digest: op.Digest, Job: "publish-job", StageID: id}); err != nil {
				t.Fatal(err)
			}
			if err := s.renamePinned(target, backup, false); err != nil {
				t.Fatal(err)
			}
			if published {
				if err := root.Link(tmp, target); err != nil {
					t.Fatal(err)
				}
			}
			s.cleanup(time.Now())
			s.cleanup(time.Now())
			contents, err := root.ReadFile(target)
			want := "original"
			if published {
				want = string(data)
			}
			if err != nil || string(contents) != want {
				t.Fatal("recovered data", string(contents), err)
			}
			handle, err := s.openRegular(target, os.O_RDONLY)
			if err != nil {
				t.Fatal("recovered file must have one link", err)
			}
			handle.Close()
			for _, name := range []string{backup, marker} {
				if _, err := root.Lstat(name); !errors.Is(err, fs.ErrNotExist) {
					t.Fatal("unrecovered name", name, err)
				}
			}
		})
	}
}

func TestExpiredCopyAndPersistentJobReceipt(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, namespace: "test", writable: true}
	if err := root.WriteFile("src", []byte("bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.handle(operation{Op: "copy", Path: "src", Destination: "dst", deadline: time.Now().Add(-time.Second)}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expired COPY", err)
	}
	if _, err := root.Stat("dst"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("expired publish", err)
	}
	job := work{ID: "unique-move", Operation: operation{Op: "rename", Path: "src", Destination: "dst", deadline: time.Now().Add(time.Minute)}}
	answer, err := s.dispatch(context.Background(), job)
	if err != nil || answer.Error != "" {
		t.Fatalf("first delivery: %v %v", answer, err)
	}
	newProcess := share{root: root, namespace: "test", writable: true}
	if pending := newProcess.pendingReceipt(); pending == nil || pending.ID != job.ID || pending.Result.Error != "" {
		t.Fatal("missing saved receipt", pending)
	}
	if err := root.WriteFile("src", []byte("new source"), 0600); err != nil {
		t.Fatal(err)
	}
	replayed, err := newProcess.dispatch(context.Background(), job)
	if err != nil || replayed.Error != "" {
		t.Fatal("duplicate did not return its original result", err, replayed)
	}
	if b, err := root.ReadFile("src"); err != nil || string(b) != "new source" {
		t.Fatal("duplicate moved the new source", err)
	}
	if err := s.renamePinned("src", "dst", false); !errors.Is(err, fs.ErrExist) {
		t.Fatal("occupied native destination", err)
	}
	if b, err := root.ReadFile("dst"); err != nil || string(b) != "bytes" {
		t.Fatal("no-replace changed destination", err)
	}
}

func TestVersionDistinguishesEqualSizedReplacementWithPreservedTime(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "version"}
	timestamp := time.Unix(1600000000, 0)
	for _, item := range []struct{ name, text string }{{"file", "one"}, {"updated", "two"}} {
		if err = root.WriteFile(item.name, []byte(item.text), 0600); err != nil {
			t.Fatal(err)
		}
		if err = root.Chtimes(item.name, timestamp, timestamp); err != nil {
			t.Fatal(err)
		}
	}
	stat, err := s.handle(operation{Op: "stat", Path: "file"})
	if err != nil {
		t.Fatal(err)
	}
	if err = root.Rename("updated", "file"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.handle(operation{Op: "delete", Path: "file", Version: stat.Entry.Version}); !errors.Is(err, changed) {
		t.Fatalf("stale version: %v", err)
	}
	data, err := root.ReadFile("file")
	if err != nil || string(data) != "two" {
		t.Fatalf("updated file: %q %v", data, err)
	}
}

func TestExpiredDirectoryOperationsAndExclusiveExecutor(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "deadline"}
	if err = root.WriteFile("source", []byte("current"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, op := range []operation{{Op: "mkdir", Path: "target"}, {Op: "delete", Path: "source"}, {Op: "rename-exclusive", Path: "source", Destination: "target"}, {Op: "copy-step", Step: "promote", Path: "target"}} {
		op.deadline = time.Now().Add(-time.Second)
		if _, err = s.handle(op); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("%s: %v", op.Op, err)
		}
	}
	if _, err = root.Stat("target"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired operation created a name")
	}
	if _, err = root.Stat("source"); err != nil {
		t.Fatal(err)
	}
	first, err := root.OpenFile("lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	other, err := root.OpenFile("lock", os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = lockExecutor(first); err != nil {
		t.Fatal(err)
	}
	if lockExecutor(other) == nil {
		t.Fatal("second write executor acquired an active lock")
	}
	first.Close()
	if err = lockExecutor(other); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteRestoresEntryReplacedAfterVersionCheck(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "delete"}
	if err := root.WriteFile("target", []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	original, err := root.Open("target")
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	checked, err := original.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := root.Rename("target", "moved"); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile("target", []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, op := range []operation{{Op: "delete", Path: "target"}, {Op: "copy-step", Step: "rollback", Path: "target"}} {
		if err := s.quarantineAndRemove(root, op, checked); !errors.Is(err, changed) {
			t.Fatalf("replacement after check: %v", err)
		}
		if data, err := root.ReadFile("target"); err != nil || string(data) != "new" {
			t.Fatalf("replacement lost: %q %v", data, err)
		}
	}
}

func TestStatAndListRejectIntraShareSymlinksAndSwapRace(t *testing.T) {
	dir := t.TempDir()
	for _, sub := range []string{"granted/sub", "private"} {
		if err := os.MkdirAll(filepath.Join(dir, filepath.FromSlash(sub)), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "granted", "sub", "ok.txt"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "private", "secret.txt"), []byte("top-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../private", filepath.Join(dir, "granted", "link-dir")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink("../../private/secret.txt", filepath.Join(dir, "granted", "sub", "link-file")); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root}

	for _, target := range []string{"granted/link-dir", "granted/link-dir/secret.txt", "granted/sub/link-file"} {
		if _, err := s.handle(operation{Op: "stat", Path: target}); err == nil {
			t.Fatalf("stat accepted symlink path %q", target)
		}
	}
	if _, err := s.handle(operation{Op: "list", Path: "granted/link-dir"}); err == nil {
		t.Fatal("list accepted intra-share symlink directory")
	}
	listed, err := s.handle(operation{Op: "list", Path: "granted/sub"})
	if err != nil || listed.Entries == nil || len(*listed.Entries) != 1 || (*listed.Entries)[0].Name != "ok.txt" {
		t.Fatalf("unexpected listing for granted/sub: %+v, err=%v", listed.Entries, err)
	}

	// Concurrent swap between a real directory and an intra-share symlink must never leak private/secret.txt.
	swapPath := filepath.Join(dir, "granted", "swap")
	realDir := filepath.Join(dir, "granted", "real-swap")
	if err := os.Mkdir(realDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "safe.txt"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = os.Remove(swapPath)
				_ = os.Symlink("../private", swapPath)
				_ = os.Remove(swapPath)
				_ = os.Rename(realDir, swapPath)
				_ = os.Rename(swapPath, realDir)
			}
		}
	}()
	for i := 0; i < 200; i++ {
		if res, err := s.handle(operation{Op: "list", Path: "granted/swap"}); err == nil && res.Entries != nil {
			for _, item := range *res.Entries {
				if item.Name == "secret.txt" {
					close(stop)
					wg.Wait()
					t.Fatal("list leaked secret.txt across intra-share symlink swap")
				}
			}
		}
		if res, err := s.handle(operation{Op: "stat", Path: "granted/swap/secret.txt"}); err == nil && res.Entry != nil {
			close(stop)
			wg.Wait()
			t.Fatal("stat leaked secret.txt across intra-share symlink swap")
		}
	}
	close(stop)
	wg.Wait()
}

func TestRecoverQuarantineBoundaries(t *testing.T) {
	const key = "123456789012345678901234567890ab"
	for _, tc := range []struct {
		name, marker                 string
		capture, live, restore, keep bool
	}{
		{"before rename", ".json", false, true, false, false},
		{"after rename", ".json", true, false, true, false},
		{"restore conflict", ".json", true, true, false, true},
		{"confirmed delete", ".confirmed", true, true, false, false},
		{"after unlink", ".confirmed", false, true, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, err := os.OpenRoot(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			s := share{root: root, writable: true, namespace: "recovery"}
			q, err := s.deletionDirectory(".")
			if err != nil {
				t.Fatal(err)
			}
			defer q.Close()
			if err := (share{root: q}).saveIntent(key+tc.marker, "target"); err != nil {
				t.Fatal(err)
			}
			if tc.live {
				if err := root.WriteFile("target", []byte("live"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if tc.capture {
				if tc.marker == ".confirmed" {
					if err := q.Mkdir(key+".entry", 0700); err != nil {
						t.Fatal(err)
					}
					if err := q.WriteFile(key+".entry/remaining", []byte("partial tree"), 0600); err != nil {
						t.Fatal(err)
					}
				} else if err := q.WriteFile(key+".entry", []byte("captured"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			s.cleanup(time.Now())
			s.cleanup(time.Now())
			body, err := root.ReadFile("target")
			want := "live"
			if tc.restore {
				want = "captured"
			}
			if err != nil || string(body) != want {
				t.Fatalf("target: %q %v", body, err)
			}
			for _, suffix := range []string{tc.marker, ".entry"} {
				_, err := q.Lstat(key + suffix)
				if (tc.keep && err != nil) || (!tc.keep && !errors.Is(err, os.ErrNotExist)) {
					t.Fatalf("%s: %v", suffix, err)
				}
			}
		})
	}
}

func TestStreamCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	r := operationReader{operation{ctx: ctx}, bytes.NewReader(make([]byte, 128*1024))}
	buf := make([]byte, 128*1024)
	if n, err := r.Read(buf); n != 64*1024 || err != nil {
		t.Fatal(n, err)
	}
	cancel()
	if n, err := r.Read(buf); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatal(n, err)
	}
}
