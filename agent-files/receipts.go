package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path"
	"time"
)

func readOperation(op string) bool {
	return op == "stat" || op == "list" || op == "read" || op == "checksum"
}

func (s share) jobMarker(id string) string {
	return path.Join(s.stageDir(), "job-"+digest([]byte(id)))
}

// The exclusive intent survives a restart. A delivered job without a final
// receipt has an unknown outcome and must never repeat its filesystem write.
func (s share) dispatch(job work) (result, error) {
	op := job.Operation
	if readOperation(op.Op) || !s.writable {
		return s.handle(op)
	}
	if job.ID == "" || len(job.ID) > 64 {
		return result{}, invalid
	}
	if err := s.ensureStageDir(); err != nil {
		return result{}, err
	}
	marker := s.jobMarker(job.ID)
	if err := s.saveIntent(marker, job.ID); err != nil {
		if !errors.Is(err, fs.ErrExist) {
			return result{}, err
		}
		var stored receipt
		if s.readIntent(marker, &stored) && stored.ID == job.ID {
			return stored.Result, nil
		}
		return result{}, changed
	}
	if err := s.replaceRecord(path.Join(s.stageDir(), "pending-receipt"), job.ID); err != nil {
		return result{}, err
	}
	answer, err := s.handle(op)
	if err != nil {
		answer = result{Error: errorCode(err)}
	}
	if err := s.replaceRecord(marker, receipt{ID: job.ID, Result: answer}); err != nil {
		return result{}, err
	}
	return answer, nil
}

func (s share) replaceRecord(name string, value any) error {
	// A process killed before rename must not block the next receipt.
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	temp := path.Join(s.stageDir(), "receipt-tmp-"+hex.EncodeToString(nonce[:]))
	f, err := s.openRegular(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return err
	}
	err = json.NewEncoder(f).Encode(value)
	err = errors.Join(err, f.Sync(), f.Close())
	if err == nil {
		err = s.root.Rename(temp, name)
	}
	if err != nil {
		s.root.Remove(temp)
	}
	return err
}

func (s share) pendingReceipt() *receipt {
	var id string
	if !s.readIntent(path.Join(s.stageDir(), "pending-receipt"), &id) || id == "" || len(id) > 64 {
		return nil
	}
	var pending receipt
	if s.readIntent(s.jobMarker(id), &pending) && pending.ID == id {
		return &pending
	}
	return &receipt{ID: id, Result: result{Error: "io"}}
}

func (s share) expireJob(name string, modified, now time.Time) {
	if now.Sub(modified) > 48*time.Hour {
		s.root.Remove(path.Join(s.stageDir(), name))
	}
}
