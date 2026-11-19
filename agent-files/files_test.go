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
	"testing"
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
			RootIdentity string
			Writable     bool
			Receipt      *receipt
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RootIdentity != rootID || body.Writable {
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
	run(operation{Op: "delete", Path: "moved.tar"})
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
