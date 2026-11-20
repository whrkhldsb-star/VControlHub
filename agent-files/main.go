package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"
)

type configuration struct {
	Hub      string `json:"hub"`
	Token    string `json:"token"`
	Root     string `json:"root"`
	Writable bool   `json:"writable"`
}
type receipt struct {
	ID     string `json:"id"`
	Result result `json:"result"`
}
type work struct {
	ID        string    `json:"id"`
	Operation operation `json:"operation"`
}
type response struct {
	Job *work `json:"job"`
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "missing"
	case errors.Is(err, fs.ErrExist):
		return "exists"
	case errors.Is(err, fs.ErrPermission), errors.Is(err, denied):
		return "denied"
	case errors.Is(err, changed):
		return "changed"
	case errors.Is(err, invalid):
		return "invalid"
	default:
		return "io"
	}
}
func poll(ctx context.Context, client *http.Client, endpoint, token, rootIdentity string, writable bool, pending *receipt) (response, error) {
	var out response
	body, err := json.Marshal(struct {
		RootIdentity string   `json:"rootIdentity"`
		Writable     bool     `json:"writable"`
		Receipt      *receipt `json:"receipt,omitempty"`
	}{rootIdentity, writable, pending})
	if err != nil {
		return out, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		return out, denied
	}
	if res.StatusCode != 200 {
		return out, fmt.Errorf("hub returned HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		return out, invalid
	}
	return out, json.Unmarshal(data, &out)
}
func run(ctx context.Context, configFile string) error {
	raw, err := os.ReadFile(configFile)
	if err != nil {
		return err
	}
	var cfg configuration
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&cfg); err != nil {
		return errors.New("invalid file Agent configuration")
	}
	hub, err := url.Parse(cfg.Hub)
	if err != nil || hub.Scheme != "https" || hub.Host == "" || hub.User != nil || hub.RawQuery != "" || hub.Fragment != "" || !strings.HasPrefix(cfg.Token, "vcf_") {
		return errors.New("configure the HTTPS hub origin and file pairing token")
	}
	if !filepath.IsAbs(cfg.Root) {
		return errors.New("configure an absolute shared directory")
	}
	rootPath, err := filepath.EvalSymlinks(cfg.Root)
	if err != nil {
		return err
	}
	configPath, err := filepath.Abs(configFile)
	if err != nil {
		return err
	}
	configPath, err = filepath.EvalSymlinks(configPath)
	if err != nil {
		return err
	}
	if filepath.Dir(rootPath) == rootPath {
		return errors.New("choose a shared subdirectory")
	}
	if rel, err := filepath.Rel(rootPath, configPath); err == nil && (rel == "." || filepath.IsLocal(rel)) {
		return errors.New("store the configuration outside the shared directory")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return err
	}
	defer root.Close()
	hub.Path = "/api/agent/v1/files"
	hub.RawPath = ""
	client := &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	s := share{root: root, writable: cfg.Writable, namespace: digest([]byte(cfg.Token))}
	hostname, err := os.Hostname()
	if err != nil {
		return err
	}
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	identity, err := directoryID(dir)
	dir.Close()
	if err != nil {
		return err
	}
	rootIdentity := "v2:" + digest([]byte(cfg.Token + "\x00" + hostname + "\x00" + rootPath + "\x00" + identity))
	var pending *receipt
	var lastCleanup time.Time
	for ctx.Err() == nil {
		if cfg.Writable && time.Since(lastCleanup) > time.Hour {
			s.cleanup(time.Now())
			lastCleanup = time.Now()
		}
		reply, err := poll(ctx, client, hub.String(), cfg.Token, rootIdentity, cfg.Writable, pending)
		if errors.Is(err, denied) {
			return errors.New("pairing revoked or node disabled")
		}
		delay := 3 * time.Second
		if pending != nil {
			delay = 200 * time.Millisecond
		}
		if err == nil {
			pending = nil
			if reply.Job != nil {
				answer, err := s.handle(reply.Job.Operation)
				if err != nil {
					answer = result{Error: errorCode(err)}
				}
				pending = &receipt{ID: reply.Job.ID, Result: answer}
				continue
			}
		} else {
			delay = 3 * time.Second
			log.Print("file Agent poll unavailable")
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(delay):
		}
	}
	return nil
}
func main() {
	config := flag.String("config", "", "path to local JSON configuration")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, *config); err != nil {
		log.Fatal(err)
	}
}
