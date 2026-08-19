package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/agents"
	copilot "github.com/rhythm-monitoring/rhythm/internal/ai"
	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/api"
	"github.com/rhythm-monitoring/rhythm/internal/audit"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/browsermonitors"
	"github.com/rhythm-monitoring/rhythm/internal/config"
	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/executionjobs"
	"github.com/rhythm-monitoring/rhythm/internal/investigation"
	"github.com/rhythm-monitoring/rhythm/internal/library"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/observability"
	"github.com/rhythm-monitoring/rhythm/internal/retention"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/sahara"
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
	roleAPI := cfg.RuntimeRole == "all" || cfg.RuntimeRole == "api"
	roleControl := cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "scheduler" || cfg.RuntimeRole == "background"
	roleWorker := cfg.RuntimeRole == "all" || cfg.RuntimeRole == "worker"
	roleBrowser := cfg.RuntimeRole == "all" || cfg.RuntimeRole == "browser"

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	checks := make(map[string]func(context.Context) error)
	var repository monitors.Repository
	var runRepository runs.Repository
	var suiteRepository suites.Repository
	var agentRepository agents.Repository
	var postgresPool *pgxpool.Pool
	var postgresRunRepository *postgres.RunRepository
	if cfg.StorageMode == "postgres" {
		pool, openErr := postgres.OpenWithOptions(context.Background(), cfg.DatabaseURL, postgres.PoolOptions{
			MaxConnections:  int32(cfg.DatabaseMaxConns),
			MinConnections:  int32(cfg.DatabaseMinConns),
			TransactionPool: cfg.DatabaseTxPooling,
			SkipInitialPing: true,
		})
		if openErr != nil {
			logger.Error("open PostgreSQL", "error", openErr)
			os.Exit(1)
		}
		defer pool.Close()
		postgresPool = pool
		if cfg.RequiredSchemaVersion != "" {
			checks["schema"] = func(ctx context.Context) error {
				return postgres.CheckRequiredSchema(ctx, pool, cfg.RequiredSchemaVersion)
			}
		}
		repository = postgres.NewMonitorRepository(pool)
		postgresRunRepository = postgres.NewRunRepository(pool)
		runRepository = postgresRunRepository
		suiteRepository = suites.NewPostgresRepository(pool)
		agentRepository = agents.NewPostgresRepository(pool)
		checks["postgres"] = pool.Ping
	} else {
		repository = monitors.NewMemoryRepository(monitors.DevelopmentSeed())
		runRepository = runs.NewMemoryRepository()
		suiteRepository = suites.NewMemoryRepository()
		agentRepository = agents.NewMemoryRepository()
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
	executor.SetTargetHostConcurrency(cfg.TargetHostConcurrency)
	if policyErr := executor.SetPrivateTargetAllowlist(cfg.PrivateTargetHosts, cfg.PrivateTargetCIDRs); policyErr != nil {
		logger.Error("configure private target policy", "error", policyErr)
		os.Exit(1)
	}
	scriptClient := scripts.NewClient(cfg.ScriptRunnerURL, cfg.ScriptRunnerToken)
	executor.SetScriptExecutor(scriptClient)
	if roleAPI || roleWorker {
		checks["script-runner"] = scriptClient.Health
	}
	runService := runs.NewService(monitorService, runRepository, executor)
	var executionJobService *executionjobs.Service
	if postgresPool != nil && cfg.QueueBackend != "memory" {
		executionJobService = executionjobs.New(postgresPool, nil, runService, logger, cfg.WorkerConcurrency)
		executionJobService.SetMemoryStopPercent(cfg.WorkerMemoryStopPercent)
	}
	agentService := agents.New(agentRepository)
	runService.SetAgentRouter(agentService)
	suiteService := suites.New(suiteRepository, runService)
	var schedulerService *scheduler.Service
	var alertService *alerts.Service
	var auditService *audit.Service
	var notificationService *notifications.Service
	var saharaService *sahara.Service
	var investigationService *investigation.Service
	var elfService *elf.Service
	var dynatraceService *dynatrace.Service
	var browserMonitorService *browsermonitors.Service
	var aiService *copilot.Service
	var retentionService *retention.Service
	// Public API replicas need the scheduler service for schedule CRUD, while
	// only control replicas start the scheduling loop below.
	if postgresPool != nil && cfg.QueueBackend != "memory" && (roleAPI || roleControl) {
		schedulerService = scheduler.NewWithOptions(
			postgresPool,
			monitorService,
			runService,
			logger,
			cfg.SchedulerBatchSize,
			time.Duration(cfg.SchedulerPollMS)*time.Millisecond,
		)
	}
	if postgresPool != nil && (roleAPI || roleControl) {
		auditService = audit.New(postgresPool)
		notificationService = notifications.New(postgresPool, libraryService, logger)
		notificationService.ConfigureSMTP(notifications.SMTPConfig{
			Host:     cfg.SMTPHost,
			Port:     cfg.SMTPPort,
			From:     cfg.SMTPFrom,
			FromName: cfg.SMTPFromName,
			Username: cfg.SMTPUsername,
			Password: cfg.SMTPPassword,
		})
		saharaService = sahara.New(postgresPool, sahara.Config{
			IngestURL: cfg.SaharaIngestURL,
			Timeout:   time.Duration(cfg.SaharaTimeoutMS) * time.Millisecond,
		}, logger)
		elfService = elf.New(postgresPool, libraryService, cfg.AllowPrivateTargets)
		dynatraceAllowedHosts := cfg.DynatraceAllowedHosts
		if cfg.UnrestrictedOutbound {
			dynatraceAllowedHosts = []string{"*"}
		}
		dynatraceService = dynatrace.New(
			postgresPool,
			libraryService,
			dynatrace.NewEnvironmentV2Provider(dynatraceAllowedHosts, cfg.AllowPrivateTargets),
		)
		investigationService = investigation.New(postgresPool, elfService, dynatraceService, logger)
		alertService = alerts.New(postgresPool, elfService)
		openedAI, aiErr := copilot.New(postgresPool, cfg.SecretsEncryptionKey, copilot.NewRhythmTools(monitorService, runService, alertService, elfService))
		if aiErr != nil {
			logger.Warn("AI copilot is unavailable", "error", aiErr)
		} else {
			aiService = openedAI
			if cfg.AIOpenRouterAPIKey != "" {
				seeded, seedErr := aiService.EnsureOpenRouterFromEnv(context.Background(), cfg.AIOpenRouterAPIKey, cfg.AIOpenRouterModel, cfg.DevelopmentActorID)
				if seedErr != nil {
					logger.Warn("bootstrap OpenRouter AI provider", "error", seedErr)
				} else if seeded {
					logger.Info("seeded OpenRouter AI provider from environment")
				}
			}
		}
	}
	if postgresPool != nil && (roleAPI || roleControl || roleBrowser) {
		browserRunner := browsermonitors.NewHTTPRunner(cfg.BrowserRunnerURL, cfg.BrowserRunnerToken)
		artifactStore, artifactErr := browsermonitors.NewArtifactStore(context.Background(), browsermonitors.ArtifactStoreConfig{
			Provider: cfg.ArtifactProvider, Endpoint: cfg.ArtifactStoreURL,
			Region: cfg.ArtifactRegion, Bucket: cfg.ArtifactBucket, Prefix: cfg.ArtifactPrefix,
			AccessKey: cfg.ArtifactAccessKey, SecretKey: cfg.ArtifactSecretKey,
			KMSKeyID: cfg.ArtifactKMSKeyID, PathStyle: cfg.ArtifactPathStyle,
			AutoCreate: cfg.ArtifactAutoCreate,
		})
		if artifactErr != nil {
			logger.Error("configure browser artifact storage", "error", artifactErr)
			os.Exit(1)
		}
		if postgresRunRepository != nil && roleControl {
			postgresRunRepository.SetWarmEvidenceStore(artifactStore)
			retentionService = retention.New(postgresPool, postgresRunRepository, artifactStore, logger)
		}
		browserMonitorService, err = browsermonitors.New(
			postgresPool,
			libraryService,
			browserRunner,
			artifactStore,
			cfg.SecretsEncryptionKey,
		)
		if err != nil {
			logger.Error("configure browser monitoring", "error", err)
			os.Exit(1)
		}
		if cfg.QueueBackend != "memory" {
			browserMonitorService.ConfigureQueue(nil, logger, cfg.BrowserJobConcurrency)
		}
		if roleAPI || roleBrowser {
			checks["browser-agent"] = browserRunner.Health
		}
		checks["artifact-store"] = artifactStore.Ensure
	}
	if roleAPI && elfService != nil {
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
				FromName: cfg.SMTPFromName,
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
	suiteService.SetDynatrace(dynatraceService)
	suiteService.SetBrowser(browserMonitorService)
	if cfg.QueueBackend != "memory" && postgresPool != nil {
		suiteService.ConfigureQueue(nil, logger, cfg.DeploymentConcurrency)
	}
	var authenticator authz.Authenticator
	if cfg.AuthMode == "anonymous" {
		authenticator = authz.NewAnonymousAuthenticator(cfg.DevelopmentActorID)
	} else if cfg.AuthMode == "trusted_headers" {
		trusted, authErr := authz.NewTrustedHeaderAuthenticator(authz.TrustedHeaderConfig{
			IdentityHeader:    cfg.IdentityHeader,
			GroupsHeader:      cfg.GroupsHeader,
			TrustedProxyCIDRs: cfg.TrustedProxyCIDRs,
			RoleGroups: map[authz.Role][]string{
				authz.RoleAdministrator: cfg.AdminGroups,
				authz.RoleEditor:        cfg.EditorGroups,
				authz.RoleOperator:      cfg.OperatorGroups,
				authz.RoleViewer:        cfg.ViewerGroups,
			},
		})
		if authErr != nil {
			logger.Error("configure trusted-header authentication", "error", authErr)
			os.Exit(1)
		}
		authenticator = trusted
	} else if cfg.AuthMode == "internal" {
		authenticator = authz.RejectingAuthenticator{}
	} else {
		authenticator = authz.NewDevelopmentAuthenticator(cfg.DevelopmentActorID)
	}

	fullAPIHandler := api.NewServer(api.Dependencies{
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
		Sahara:              saharaService,
		Investigation:       investigationService,
		Scripts:             scriptClient,
		ELF:                 elfService,
		Dynatrace:           dynatraceService,
		BrowserMonitors:     browserMonitorService,
		AI:                  aiService,
		Authenticator:       authenticator,
		AllowedOrigin:       cfg.AllowedOrigin,
		AllowPrivateTargets: cfg.AllowPrivateTargets,
		Checks:              checks,
		WebhookRateLimiter:  nil,
	})
	var handler http.Handler = fullAPIHandler
	if cfg.RuntimeRole != "all" && cfg.RuntimeRole != "api" {
		handler = roleHealthHandler(cfg.RuntimeRole, checks)
	}
	handler = api.CompressResponse(handler)
	metrics := observability.New(postgresPool, observability.CapacityConfig{
		WorkerConcurrency:        cfg.ExecutorSlotsPerReplica,
		MinReplicas:              cfg.ExecutorMinReplicas,
		MaxReplicas:              cfg.ExecutorMaxReplicas,
		TargetUtilizationPercent: cfg.ExecutorTargetPercent,
	})
	instrumented := metrics.Wrap(handler)
	rootHandler := http.NewServeMux()
	rootHandler.Handle("GET /metrics", metrics.Handler())
	rootHandler.Handle("POST /internal/web-vitals", metrics.WebVitalHandler())
	rootHandler.Handle("/", instrumented)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           rootHandler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if executionJobService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "scheduler" || cfg.RuntimeRole == "background") {
		executionJobService.StartDispatcher(shutdownContext)
	}
	if executionJobService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "worker") {
		executionJobService.StartWorkers(shutdownContext)
	}
	if schedulerService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "scheduler") {
		schedulerService.Start(shutdownContext)
	}
	if notificationService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		notificationService.Start(shutdownContext)
	}
	if saharaService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		saharaService.Start(shutdownContext)
	}
	if investigationService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		investigationService.Start(shutdownContext)
	}
	if alertService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		alertService.Start(shutdownContext)
	}
	if browserMonitorService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "background" || cfg.RuntimeRole == "browser") {
		go browserMonitorService.Start(shutdownContext)
	}
	if suiteService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		suiteService.StartQueueWorkers(shutdownContext)
	}
	if retentionService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control" || cfg.RuntimeRole == "background") {
		retentionService.Start(shutdownContext)
	}
	if aiService != nil && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "control") {
		aiService.StartRetention(shutdownContext)
	}

	go func() {
		logger.Info("rhythm service listening", "address", cfg.HTTPAddr, "role", cfg.RuntimeRole, "authMode", cfg.AuthMode, "storageMode", cfg.StorageMode, "queueBackend", cfg.QueueBackend, "unrestrictedOutbound", cfg.UnrestrictedOutbound)
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

func roleHealthHandler(role string, checks map[string]func(context.Context) error) http.Handler {
	mux := http.NewServeMux()
	live := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(`{"status":"ok","role":"` + role + `"}`))
	}
	mux.HandleFunc("GET /livez", live)
	mux.HandleFunc("GET /healthz", live)
	mux.HandleFunc("GET /health", live)
	ready := func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		status := http.StatusOK
		for _, check := range checks {
			if err := check(ctx); err != nil {
				status = http.StatusServiceUnavailable
				break
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = w.Write([]byte(`{"status":"ok","role":"` + role + `"}`))
		} else {
			_, _ = w.Write([]byte(`{"status":"degraded","role":"` + role + `"}`))
		}
	}
	mux.HandleFunc("GET /readyz", ready)
	return mux
}
