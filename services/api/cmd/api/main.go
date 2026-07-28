package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/agents"
	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/api"
	"github.com/rhythm-monitoring/rhythm/internal/audit"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/config"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/library"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/queue"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/scheduler"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
	"github.com/rhythm-monitoring/rhythm/internal/storage/postgres"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	checks := make(map[string]func(context.Context) error)
	var repository monitors.Repository
	var runRepository runs.Repository
	var suiteRepository suites.Repository
	var agentRepository agents.Repository
	var postgresPool *pgxpool.Pool
	var redisClient *redis.Client
	if cfg.StorageMode == "postgres" {
		pool, openErr := postgres.Open(context.Background(), cfg.DatabaseURL)
		if openErr != nil {
			logger.Error("open PostgreSQL", "error", openErr)
			os.Exit(1)
		}
		defer pool.Close()
		postgresPool = pool
		repository = postgres.NewMonitorRepository(pool)
		runRepository = postgres.NewRunRepository(pool)
		suiteRepository = suites.NewPostgresRepository(pool)
		agentRepository = agents.NewPostgresRepository(pool)
		checks["postgres"] = pool.Ping
	} else {
		repository = monitors.NewMemoryRepository(monitors.DevelopmentSeed())
		runRepository = runs.NewMemoryRepository()
		suiteRepository = suites.NewMemoryRepository()
		agentRepository = agents.NewMemoryRepository()
	}
	if cfg.RedisURL != "" {
		openedRedis, openErr := queue.OpenRedis(context.Background(), cfg.RedisURL)
		if openErr != nil {
			logger.Error("open Redis", "error", openErr)
			os.Exit(1)
		}
		redisClient = openedRedis
		defer func() { _ = redisClient.Close() }()
		checks["redis"] = func(ctx context.Context) error { return redisClient.Ping(ctx).Err() }
	}
	monitorService := monitors.NewService(repository)
	var libraryService *library.Service
	if postgresPool != nil {
		openedLibrary, libraryErr := library.New(postgresPool, cfg.SecretsEncryptionKey)
		if libraryErr != nil {
			logger.Error("configure configuration library", "error", libraryErr)
			os.Exit(1)
		}
		libraryService = openedLibrary
	}
	executor := runs.NewHTTPExecutor(cfg.AllowPrivateTargets)
	if libraryService != nil {
		executor = runs.NewHTTPExecutorWithResolver(cfg.AllowPrivateTargets, libraryService)
	}
	scriptClient := scripts.NewClient(cfg.ScriptRunnerURL, cfg.ScriptRunnerToken)
	executor.SetScriptExecutor(scriptClient)
	checks["script-runner"] = scriptClient.Health
	runService := runs.NewService(monitorService, runRepository, executor)
	agentService := agents.New(agentRepository)
	runService.SetAgentRouter(agentService)
	suiteService := suites.New(suiteRepository, runService)
	var schedulerService *scheduler.Service
	var alertService *alerts.Service
	var auditService *audit.Service
	var notificationService *notifications.Service
	var elfService *elf.Service
	if postgresPool != nil && redisClient != nil {
		schedulerService = scheduler.New(postgresPool, redisClient, monitorService, runService, logger)
	}
	if postgresPool != nil {
		auditService = audit.New(postgresPool)
		notificationService = notifications.New(postgresPool, libraryService, logger)
		elfService = elf.New(postgresPool, libraryService, cfg.AllowPrivateTargets)
		alertService = alerts.New(postgresPool, elfService)
		if cfg.ELFBootstrapURL != "" {
			if err := elfService.EnsureDevelopmentSeed(context.Background(), cfg.ELFBootstrapURL, cfg.DevelopmentActorID); err != nil {
				logger.Warn("bootstrap local ELF resources", "error", err)
			}
		}
		if libraryService != nil && cfg.SMTPHost != "" {
			if _, created, err := libraryService.EnsureDefaultEmailChannel(context.Background(), library.SMTPDefaults{
				Host:     cfg.SMTPHost,
				Port:     cfg.SMTPPort,
				From:     cfg.SMTPFrom,
				Username: cfg.SMTPUsername,
				Password: cfg.SMTPPassword,
				To:       cfg.SMTPTo,
			}, cfg.DevelopmentActorID); err != nil {
				logger.Warn("bootstrap SMTP notification channel", "error", err)
			} else if created {
				logger.Info("seeded local SMTP notification channel", "host", cfg.SMTPHost, "port", cfg.SMTPPort, "from", cfg.SMTPFrom)
			}
		}
	}
	suiteService.SetELF(elfService)
	suiteService.SetAlerts(alertService)
	authenticator := authz.NewDevelopmentAuthenticator(cfg.DevelopmentActorID)

	handler := api.NewServer(api.Dependencies{
		Logger:              logger,
		Monitors:            monitorService,
		Runs:                runService,
		Scheduler:           schedulerService,
		Alerts:              alertService,
		Audit:               auditService,
		Library:             libraryService,
		Suites:              suiteService,
		Agents:              agentService,
		Notifications:       notificationService,
		Scripts:             scriptClient,
		ELF:                 elfService,
		Authenticator:       authenticator,
		AllowedOrigin:       cfg.AllowedOrigin,
		AllowPrivateTargets: cfg.AllowPrivateTargets,
		Checks:              checks,
	})

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if schedulerService != nil {
		schedulerService.Start(shutdownContext)
	}
	if notificationService != nil {
		notificationService.Start(shutdownContext)
	}
	if alertService != nil {
		alertService.Start(shutdownContext)
	}

	go func() {
		logger.Info("rhythm api listening", "address", cfg.HTTPAddr, "authMode", "development", "storageMode", cfg.StorageMode)
		if serveErr := server.ListenAndServe(); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			logger.Error("api server failed", "error", serveErr)
			os.Exit(1)
		}
	}()

	<-shutdownContext.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("api shutdown failed", "error", err)
	}
}
