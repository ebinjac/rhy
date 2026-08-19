package lab

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	randv2 "math/rand/v2"
	"sync"
	"time"
)

type tokenRecord struct {
	ExpiresAt time.Time
	Subject   string
}
type workflowRecord struct {
	Token    string
	StepID   string
	Complete bool
}
type rateRecord struct {
	Started time.Time
	Count   int
}

type State struct {
	mu            sync.Mutex
	tokens        map[string]tokenRecord
	sessions      map[string]tokenRecord
	workflows     map[string]workflowRecord
	retries       map[string]int
	rates         map[string]rateRecord
	nonces        map[string]time.Time
	requests      uint64
	errors        uint64
	statuses      map[int]uint64
	deterministic bool
	sequence      uint64
}

func NewState(deterministic bool) *State {
	return &State{tokens: map[string]tokenRecord{}, sessions: map[string]tokenRecord{}, workflows: map[string]workflowRecord{}, retries: map[string]int{}, rates: map[string]rateRecord{}, nonces: map[string]time.Time{}, statuses: map[int]uint64{}, deterministic: deterministic}
}
func (s *State) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens = map[string]tokenRecord{}
	s.sessions = map[string]tokenRecord{}
	s.workflows = map[string]workflowRecord{}
	s.retries = map[string]int{}
	s.rates = map[string]rateRecord{}
	s.nonces = map[string]time.Time{}
	s.requests = 0
	s.errors = 0
	s.statuses = map[int]uint64{}
}
func (s *State) ID(prefix string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sequence++
	if s.deterministic {
		return prefix + "-deterministic-" + itoa(int(s.sequence))
	}
	b := make([]byte, 16)
	_, _ = cryptorand.Read(b)
	return prefix + "-" + hex.EncodeToString(b)
}
func (s *State) RandomInt(max int) int {
	if max <= 0 {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deterministic {
		s.sequence++
		return int(s.sequence % uint64(max))
	}
	return randv2.IntN(max)
}
func itoa(v int) string {
	const digits = "0123456789"
	if v == 0 {
		return "0"
	}
	b := make([]byte, 0, 20)
	for v > 0 {
		b = append(b, digits[v%10])
		v /= 10
	}
	for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
		b[i], b[j] = b[j], b[i]
	}
	return string(b)
}
