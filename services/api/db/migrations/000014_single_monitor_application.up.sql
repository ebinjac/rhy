DELETE FROM application_monitor_links current_link
USING application_monitor_links older_link
WHERE current_link.monitor_id = older_link.monitor_id
  AND (current_link.created_at, current_link.application_id) >
      (older_link.created_at, older_link.application_id);

CREATE UNIQUE INDEX application_monitor_links_monitor_unique
    ON application_monitor_links (monitor_id);

