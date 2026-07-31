package api

import (
	"errors"
	"net/http"
	"sync"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

type overviewSnapshot struct {
	Monitors      []monitors.Monitor            `json:"monitors"`
	Alerts        []alerts.Alert                `json:"alerts"`
	Runs          []runs.Run                    `json:"runs"`
	Deployments   []suites.DeploymentRunSummary `json:"deployments"`
	Applications  []elf.Application             `json:"applications"`
	ELFConfigured bool                          `json:"elfConfigured"`
	Counts        map[string]int                `json:"counts"`
}

func (s *server) getOverview(w http.ResponseWriter, r *http.Request) {
	snapshot := overviewSnapshot{
		Monitors: []monitors.Monitor{}, Alerts: []alerts.Alert{},
		Runs: []runs.Run{}, Deployments: []suites.DeploymentRunSummary{},
		Applications: []elf.Application{}, Counts: map[string]int{},
	}
	var wait sync.WaitGroup
	var lock sync.Mutex
	var firstErr error
	run := func(work func() error) {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if err := work(); err != nil {
				lock.Lock()
				if firstErr == nil {
					firstErr = err
				}
				lock.Unlock()
			}
		}()
	}
	run(func() error {
		overview, err := s.monitors.Overview(r.Context(), 12)
		if err != nil {
			return err
		}
		lock.Lock()
		snapshot.Counts["monitors"] = overview.Counts.Total
		snapshot.Counts["enabledMonitors"] = overview.Counts.Enabled
		snapshot.Counts["healthyMonitors"] = overview.Counts.Healthy
		snapshot.Counts["attentionMonitors"] = overview.Counts.Attention
		snapshot.Monitors = overview.Items
		lock.Unlock()
		return nil
	})
	run(func() error {
		if s.alerts == nil {
			return nil
		}
		overview, err := s.alerts.Overview(r.Context(), 5)
		if err != nil {
			return err
		}
		lock.Lock()
		snapshot.Counts["activeAlerts"] = overview.ActiveCount
		snapshot.Counts["criticalAlerts"] = overview.CriticalCount
		snapshot.Alerts = overview.Items
		lock.Unlock()
		return nil
	})
	run(func() error {
		items, err := s.runs.ListRecent(r.Context(), 10)
		if err != nil {
			return err
		}
		lock.Lock()
		snapshot.Runs = items
		lock.Unlock()
		return nil
	})
	run(func() error {
		if s.suites == nil {
			return nil
		}
		overview, err := s.suites.DeploymentOverview(r.Context(), 4)
		if err != nil {
			return err
		}
		lock.Lock()
		snapshot.Counts["deployments"] = overview.DeploymentCount
		snapshot.Counts["suites"] = overview.SuiteCount
		snapshot.Deployments = overview.Runs
		lock.Unlock()
		return nil
	})
	run(func() error {
		if s.elf == nil {
			return nil
		}
		overview, err := s.elf.Overview(r.Context(), 4)
		if err != nil {
			return err
		}
		_, settingsErr := s.elf.GetSettings(r.Context())
		configured := settingsErr == nil
		if settingsErr != nil && !errors.Is(settingsErr, elf.ErrNotFound) {
			return settingsErr
		}
		lock.Lock()
		snapshot.Counts["applications"] = overview.ApplicationCount
		snapshot.Counts["elfQueries"] = overview.QueryCount
		snapshot.Applications = overview.Applications
		snapshot.ELFConfigured = configured
		lock.Unlock()
		return nil
	})
	wait.Wait()
	if firstErr != nil {
		s.writeError(w, r, http.StatusInternalServerError, "OVERVIEW_UNAVAILABLE", "The operational overview could not be loaded.", nil)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10, stale-while-revalidate=30")
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: snapshot, Meta: s.meta(r)})
}
