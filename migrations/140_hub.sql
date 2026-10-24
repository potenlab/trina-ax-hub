-- hub sessions (src/hub)

-- team-folder path of the Markdown file a schedule run saved (shown as the schedule's last result)
ALTER TABLE hub_jobs ADD COLUMN output_path TEXT;

-- the model of a chat's first turn: later turns pass it with --resume (Claude Code 2.1.309 otherwise resumes on a
-- different default model)
ALTER TABLE hub_chats ADD COLUMN model TEXT;

CREATE INDEX hub_jobs_chat ON hub_jobs(chat_id, status);
CREATE INDEX hub_jobs_schedule ON hub_jobs(schedule_id, created_at);
CREATE INDEX hub_chats_user ON hub_chats(user_id, updated_at);
CREATE INDEX schedules_due ON schedules(enabled, next_run_at);
