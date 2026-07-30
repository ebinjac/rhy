package monitors

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var teamPackageNamePattern = regexp.MustCompile(`^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type ValidationError struct {
	Fields []FieldError `json:"fields"`
}

func (e ValidationError) Error() string { return "monitor definition is invalid" }

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) List(ctx context.Context) ([]Monitor, error) {
	return s.repository.List(ctx)
}

func (s *Service) Get(ctx context.Context, monitorID string) (Monitor, error) {
	return s.repository.Get(ctx, monitorID)
}

func (s *Service) ListRevisions(ctx context.Context, monitorID string) ([]Revision, error) {
	return s.repository.ListRevisions(ctx, monitorID)
}

func (s *Service) GetRevision(ctx context.Context, monitorID, revisionID string) (Revision, error) {
	return s.repository.GetRevision(ctx, monitorID, revisionID)
}

func (s *Service) Diff(ctx context.Context, monitorID, fromID, toID string) (map[string]any, error) {
	from, err := s.repository.GetRevision(ctx, monitorID, fromID)
	if err != nil {
		return nil, err
	}
	to, err := s.repository.GetRevision(ctx, monitorID, toID)
	if err != nil {
		return nil, err
	}
	fromJSON, _ := json.Marshal(from.Definition)
	toJSON, _ := json.Marshal(to.Definition)
	return map[string]any{"from": from, "to": to, "changed": string(fromJSON) != string(toJSON)}, nil
}

func (s *Service) Export(ctx context.Context, monitorID string) (map[string]any, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return nil, err
	}
	revisions, err := s.repository.ListRevisions(ctx, monitorID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"format": "rhythm-monitor", "version": 1, "monitor": monitor, "revisions": revisions}, nil
}

func (s *Service) RestoreRevision(ctx context.Context, monitorID, revisionID, actorID string) (Monitor, Revision, error) {
	revision, err := s.repository.GetRevision(ctx, monitorID, revisionID)
	if err != nil {
		return Monitor{}, Revision{}, err
	}
	return s.repository.UpdateDraft(ctx, monitorID, cloneDefinition(revision.Definition), actorID, s.now())
}

func (s *Service) Create(ctx context.Context, input CreateInput, actorID string) (Monitor, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = strings.TrimSpace(input.Slug)
	input.Description = strings.TrimSpace(input.Description)
	input.OwnerID = strings.TrimSpace(input.OwnerID)
	input.Tags = normalizeTags(input.Tags)
	errorsByField := validateMetadata(input.Name, input.Slug, input.Description, input.OwnerID, input.Tags)
	if len(errorsByField) > 0 {
		return Monitor{}, ValidationError{Fields: errorsByField}
	}

	monitorID, err := id.NewUUID()
	if err != nil {
		return Monitor{}, err
	}
	revisionID, err := id.NewUUID()
	if err != nil {
		return Monitor{}, err
	}
	now := s.now()
	monitor := Monitor{
		ID: monitorID, Name: input.Name, Slug: input.Slug, Description: input.Description,
		OwnerID: input.OwnerID, Tags: append([]string(nil), input.Tags...), EnvironmentID: input.EnvironmentID,
		State: StateDraft, Health: HealthUnknown, Enabled: false, CurrentDraftRevisionID: revisionID,
		CreatedBy: actorID, UpdatedBy: actorID, CreatedAt: now, UpdatedAt: now,
	}
	definition := input.Definition
	if definition == nil {
		definition = map[string]any{"steps": []any{}}
	}
	normalizeScriptEnabledFlags(definition)
	revision := Revision{
		ID: revisionID, MonitorID: monitorID, RevisionNumber: 1, Status: RevisionDraft,
		SchemaVersion: 1, Definition: definition, CreatedBy: actorID, CreatedAt: now,
	}
	created, err := s.repository.Create(ctx, monitor, revision)
	if errors.Is(err, ErrConflict) {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "slug", Message: "A monitor with this slug already exists."}}}
	}
	return created, err
}

func (s *Service) Update(ctx context.Context, monitorID string, input UpdateInput, actorID string, expectedUpdatedAt time.Time) (Monitor, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	if input.Name != nil {
		monitor.Name = strings.TrimSpace(*input.Name)
	}
	if input.Slug != nil {
		monitor.Slug = strings.TrimSpace(*input.Slug)
	}
	if input.Description != nil {
		monitor.Description = strings.TrimSpace(*input.Description)
	}
	if input.OwnerID != nil {
		monitor.OwnerID = strings.TrimSpace(*input.OwnerID)
	}
	if input.Tags != nil {
		monitor.Tags = normalizeTags(*input.Tags)
	}
	if input.EnvironmentID != nil {
		monitor.EnvironmentID = strings.TrimSpace(*input.EnvironmentID)
	}
	if fieldErrors := validateMetadata(monitor.Name, monitor.Slug, monitor.Description, monitor.OwnerID, monitor.Tags); len(fieldErrors) > 0 {
		return Monitor{}, ValidationError{Fields: fieldErrors}
	}
	monitor.UpdatedBy = actorID
	monitor.UpdatedAt = s.now()
	updated, err := s.repository.Update(ctx, monitor, expectedUpdatedAt)
	if errors.Is(err, ErrConflict) {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "slug", Message: "A monitor with this slug already exists."}}}
	}
	return updated, err
}

func (s *Service) Delete(ctx context.Context, monitorID, actorID string) error {
	return s.repository.SoftDelete(ctx, monitorID, actorID, s.now())
}

func (s *Service) PermanentDelete(ctx context.Context, monitorIDs []string) (int64, error) {
	if len(monitorIDs) == 0 {
		return 0, ValidationError{Fields: []FieldError{{Path: "monitorIds", Message: "Select at least one monitor."}}}
	}
	if len(monitorIDs) > 100 {
		return 0, ValidationError{Fields: []FieldError{{Path: "monitorIds", Message: "Delete no more than 100 monitors at once."}}}
	}
	unique := make([]string, 0, len(monitorIDs))
	seen := make(map[string]bool, len(monitorIDs))
	for _, monitorID := range monitorIDs {
		monitorID = strings.TrimSpace(monitorID)
		if monitorID == "" || seen[monitorID] {
			continue
		}
		seen[monitorID] = true
		unique = append(unique, monitorID)
	}
	if len(unique) == 0 {
		return 0, ValidationError{Fields: []FieldError{{Path: "monitorIds", Message: "Select at least one monitor."}}}
	}
	return s.repository.PermanentDelete(ctx, unique)
}

func (s *Service) SaveDraft(ctx context.Context, monitorID string, input DraftInput, actorID string) (Monitor, Revision, error) {
	if fields := ValidateDefinition(input.Definition); len(fields) > 0 {
		return Monitor{}, Revision{}, ValidationError{Fields: fields}
	}
	normalizeScriptEnabledFlags(input.Definition)
	return s.repository.UpdateDraft(ctx, monitorID, input.Definition, actorID, s.now())
}

func (s *Service) Validate(ctx context.Context, monitorID string) ([]FieldError, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return nil, err
	}
	revision, err := s.repository.GetRevision(ctx, monitorID, monitor.CurrentDraftRevisionID)
	if err != nil {
		return nil, err
	}
	return ValidateDefinition(revision.Definition), nil
}

func (s *Service) Publish(ctx context.Context, monitorID string, input PublishInput, actorID string) (Monitor, Revision, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, Revision{}, err
	}
	if monitor.State == StateArchived {
		return Monitor{}, Revision{}, ValidationError{Fields: []FieldError{{Path: "state", Message: "Restore the monitor before publishing."}}}
	}
	current, err := s.repository.GetRevision(ctx, monitorID, monitor.CurrentDraftRevisionID)
	if err != nil {
		return Monitor{}, Revision{}, err
	}
	if fields := ValidateDefinition(current.Definition); len(fields) > 0 {
		return Monitor{}, Revision{}, ValidationError{Fields: fields}
	}
	nextID, err := id.NewUUID()
	if err != nil {
		return Monitor{}, Revision{}, err
	}
	now := s.now()
	published := current
	published.Status, published.ChangeSummary, published.PublishedBy, published.PublishedAt = RevisionPublished, strings.TrimSpace(input.ChangeSummary), actorID, &now
	nextDraft := Revision{ID: nextID, MonitorID: monitorID, RevisionNumber: current.RevisionNumber + 1, Status: RevisionDraft, SchemaVersion: current.SchemaVersion, Definition: cloneDefinition(current.Definition), CreatedBy: actorID, CreatedAt: now}
	return s.repository.Publish(ctx, monitorID, published, nextDraft, actorID, now)
}

func (s *Service) Enable(ctx context.Context, monitorID, actorID string) (Monitor, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	if monitor.LatestPublishedRevisionID == "" {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "state", Message: "Publish a valid revision before enabling."}}}
	}
	if monitor.State == StateArchived {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "state", Message: "Restore the monitor before enabling."}}}
	}
	return s.repository.SetState(ctx, monitorID, StateEnabled, true, actorID, s.now())
}

func (s *Service) Disable(ctx context.Context, monitorID, actorID string) (Monitor, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	if monitor.State == StateArchived {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "state", Message: "Archived monitors are already inactive."}}}
	}
	return s.repository.SetState(ctx, monitorID, StateDisabled, false, actorID, s.now())
}

func (s *Service) Archive(ctx context.Context, monitorID, actorID string) (Monitor, error) {
	return s.repository.SetState(ctx, monitorID, StateArchived, false, actorID, s.now())
}

func (s *Service) Restore(ctx context.Context, monitorID, actorID string) (Monitor, error) {
	monitor, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	if monitor.State != StateArchived {
		return Monitor{}, ValidationError{Fields: []FieldError{{Path: "state", Message: "Only archived monitors can be restored."}}}
	}
	state := StateDraft
	if monitor.LatestPublishedRevisionID != "" {
		state = StateDisabled
	}
	return s.repository.SetState(ctx, monitorID, state, false, actorID, s.now())
}

func (s *Service) Clone(ctx context.Context, monitorID string, input CloneInput, actorID string) (Monitor, error) {
	source, err := s.repository.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	revision, err := s.repository.GetRevision(ctx, monitorID, source.CurrentDraftRevisionID)
	if err != nil {
		return Monitor{}, err
	}
	return s.Create(ctx, CreateInput{Name: input.Name, Slug: input.Slug, Description: source.Description, OwnerID: source.OwnerID, Tags: source.Tags, EnvironmentID: source.EnvironmentID, Definition: cloneDefinition(revision.Definition)}, actorID)
}

func ValidateDefinition(definition map[string]any) []FieldError {
	fields := make([]FieldError, 0)
	if scriptGroup, ok := definition["scripts"].(map[string]any); ok {
		fields = append(fields, validateScriptObject("definition.scripts.preRequest", scriptGroup["preRequest"])...)
	}
	steps, ok := definition["steps"].([]any)
	if !ok || len(steps) == 0 {
		return []FieldError{{Path: "definition.steps", Message: "Add at least one workflow step."}}
	}
	seenIDs := make(map[string]bool)
	for index, raw := range steps {
		path := fmt.Sprintf("definition.steps.%d", index)
		step, ok := raw.(map[string]any)
		if !ok {
			fields = append(fields, FieldError{Path: path, Message: "Step must be an object."})
			continue
		}
		stepID, _ := step["id"].(string)
		if strings.TrimSpace(stepID) == "" {
			fields = append(fields, FieldError{Path: path + ".id", Message: "Step ID is required."})
		} else if seenIDs[stepID] {
			fields = append(fields, FieldError{Path: path + ".id", Message: "Step IDs must be unique."})
		}
		seenIDs[stepID] = true
		stepType, _ := step["type"].(string)
		if stepType != "HTTP_REQUEST" && stepType != "ACTION" && stepType != "METRIC_VALIDATION" {
			fields = append(fields, FieldError{Path: path + ".type", Message: "Step type must be HTTP_REQUEST, ACTION, or METRIC_VALIDATION."})
		}
		if stepType == "ACTION" {
			actions, ok := step["actions"].([]any)
			if !ok || len(actions) == 0 {
				fields = append(fields, FieldError{Path: path + ".actions", Message: "Action steps require at least one controlled action."})
			}
			continue
		}
		if stepType == "METRIC_VALIDATION" {
			metric, ok := step["metric"].(map[string]any)
			if !ok || strings.TrimSpace(fmt.Sprint(metric["profileId"])) == "" || strings.TrimSpace(fmt.Sprint(metric["metricSelector"])) == "" {
				fields = append(fields, FieldError{Path: path + ".metric", Message: "Metric validation requires a provider profile and metric selector."})
			}
			continue
		}
		request, ok := step["request"].(map[string]any)
		if !ok {
			fields = append(fields, FieldError{Path: path + ".request", Message: "Request configuration is required."})
			continue
		}
		method, _ := request["method"].(string)
		if strings.TrimSpace(method) == "" {
			fields = append(fields, FieldError{Path: path + ".request.method", Message: "HTTP method is required."})
		}
		target, _ := request["url"].(string)
		if strings.TrimSpace(target) == "" {
			fields = append(fields, FieldError{Path: path + ".request.url", Message: "Request URL is required."})
		}
		fields = append(fields, validateScriptObject(path+".request.preRequestScript", request["preRequestScript"])...)
		fields = append(fields, validateScriptObject(path+".request.testScript", request["testScript"])...)
	}
	return fields
}

func validateScriptObject(path string, raw any) []FieldError {
	value, ok := raw.(map[string]any)
	if !ok || value == nil {
		return nil
	}
	code, _ := value["code"].(string)
	// Non-empty scripts are always treated as enabled (Postman-style).
	fields := make([]FieldError, 0)
	if strings.TrimSpace(code) != "" {
		validation := scripts.NewRuntime().Validate(code)
		if !validation.Valid {
			problem := validation.Problems[0]
			fields = append(fields, FieldError{Path: path + ".code", Message: fmt.Sprintf("JavaScript line %d, column %d: %s", problem.Line, problem.Column, problem.Message)})
		}
	}
	packages, _ := value["packages"].([]any)
	names := make(map[string]bool)
	for index, rawPackage := range packages {
		item, ok := rawPackage.(map[string]any)
		packagePath := fmt.Sprintf("%s.packages.%d", path, index)
		if !ok {
			fields = append(fields, FieldError{Path: packagePath, Message: "Package must be an object."})
			continue
		}
		name := strings.TrimSpace(fmt.Sprint(item["name"]))
		packageCode := fmt.Sprint(item["code"])
		if !teamPackageNamePattern.MatchString(name) {
			fields = append(fields, FieldError{Path: packagePath + ".name", Message: "Use a scoped package name such as @team-domain/package-name."})
		} else if names[name] {
			fields = append(fields, FieldError{Path: packagePath + ".name", Message: "Package names must be unique within the script."})
		}
		names[name] = true
		if len(packageCode) > 64<<10 {
			fields = append(fields, FieldError{Path: packagePath + ".code", Message: "Package source must not exceed 64 KB."})
		} else if strings.TrimSpace(packageCode) != "" {
			validation := scripts.NewRuntime().Validate(packageCode)
			if !validation.Valid {
				problem := validation.Problems[0]
				fields = append(fields, FieldError{Path: packagePath + ".code", Message: fmt.Sprintf("JavaScript line %d, column %d: %s", problem.Line, problem.Column, problem.Message)})
			}
		}
	}
	return fields
}

// normalizeScriptEnabledFlags sets enabled from script content so stuck
// enabled:false values from the old toggle UI cannot leave scripts inert.
func normalizeScriptEnabledFlags(definition map[string]any) {
	if definition == nil {
		return
	}
	if scriptGroup, ok := definition["scripts"].(map[string]any); ok {
		setScriptEnabledFromCode(scriptGroup["preRequest"])
	}
	steps, ok := definition["steps"].([]any)
	if !ok {
		return
	}
	for _, raw := range steps {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		request, ok := step["request"].(map[string]any)
		if !ok {
			continue
		}
		setScriptEnabledFromCode(request["preRequestScript"])
		setScriptEnabledFromCode(request["testScript"])
	}
}

func setScriptEnabledFromCode(raw any) {
	value, ok := raw.(map[string]any)
	if !ok || value == nil {
		return
	}
	code, _ := value["code"].(string)
	value["enabled"] = strings.TrimSpace(code) != ""
}

func cloneDefinition(definition map[string]any) map[string]any {
	copy := make(map[string]any)
	encoded, err := json.Marshal(definition)
	if err == nil {
		_ = json.Unmarshal(encoded, &copy)
	}
	return copy
}

func validateMetadata(name, slug, description, ownerID string, tags []string) []FieldError {
	fields := make([]FieldError, 0)
	if name == "" {
		fields = append(fields, FieldError{Path: "name", Message: "Name is required."})
	} else if len(name) > 255 {
		fields = append(fields, FieldError{Path: "name", Message: "Name must be 255 characters or fewer."})
	}
	if !slugPattern.MatchString(slug) || len(slug) > 255 {
		fields = append(fields, FieldError{Path: "slug", Message: "Slug must contain 255 or fewer lowercase letters, numbers, and single hyphens."})
	}
	if len(description) > 2000 {
		fields = append(fields, FieldError{Path: "description", Message: "Description must be 2,000 characters or fewer."})
	}
	if len(ownerID) > 255 {
		fields = append(fields, FieldError{Path: "ownerId", Message: "Owner must be 255 characters or fewer."})
	}
	if len(tags) > 20 {
		fields = append(fields, FieldError{Path: "tags", Message: "Use no more than 20 tags."})
	}
	for index, tag := range tags {
		if tag == "" || len(tag) > 64 {
			fields = append(fields, FieldError{Path: "tags", Message: "Tag " + strconv.Itoa(index+1) + " must contain 1 to 64 characters."})
		}
	}
	return fields
}

func normalizeTags(tags []string) []string {
	normalized := make([]string, len(tags))
	for index, tag := range tags {
		normalized[index] = strings.TrimSpace(tag)
	}
	return normalized
}
