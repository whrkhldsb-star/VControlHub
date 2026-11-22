package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestUploadAcrossChildMount(t *testing.T) {
	if os.Getenv("VCH_FILE_AGENT_TEST_PRIVATE_MOUNT") != "1" {
		t.Skip("requires a private mount namespace")
	}
	dir := t.TempDir()
	volume := filepath.Join(dir, "volume")
	if err := os.Mkdir(volume, 0700); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mount("tmpfs", volume, "tmpfs", unix.MS_NOSUID|unix.MS_NODEV, "size=4m"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := unix.Unmount(volume, 0); err != nil {
			t.Error(err)
		}
	}()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := share{root: root, writable: true, namespace: "test-volume"}
	data := []byte("cross-device upload")
	op := operation{Op: "begin", Path: "volume/file", Digest: digest(data), Size: int64(len(data))}
	if err := s.ensureStageDir(); err != nil {
		t.Fatal(err)
	}
	key := digest([]byte(s.namespace + "\x00" + op.Path + "\x00" + op.Digest))
	if err := root.WriteFile(s.stageDir()+"/"+key, data[:4], 0600); err != nil {
		t.Fatal(err)
	}
	answer, err := s.handle(op)
	if err != nil || answer.Offset != 4 {
		t.Fatalf("resume from original filesystem: %v %v", answer, err)
	}
	op.Op, op.Offset, op.Data = "chunk", answer.Offset, data[answer.Offset:]
	op.ChunkDigest = digest(op.Data)
	if _, err := s.handle(op); err != nil {
		t.Fatal(err)
	}
	op.Op, op.Version, op.jobID, op.deadline = "publish", "absent", "job-submount", time.Now().Add(time.Minute)
	if _, err := s.handle(op); err != nil {
		t.Fatal(err)
	}
	if b, err := root.ReadFile(op.Path); err != nil || string(b) != string(data) {
		t.Fatalf("published on child filesystem: %q %v", b, err)
	}
	stat, err := s.handle(operation{Op: "stat", Path: op.Path})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.handle(operation{Op: "delete", Path: op.Path, Version: stat.Entry.Version}); err != nil {
		t.Fatal("delete on child filesystem", err)
	}
	if _, err := root.Stat(op.Path); !os.IsNotExist(err) {
		t.Fatalf("deleted child remains: %v", err)
	}
}
