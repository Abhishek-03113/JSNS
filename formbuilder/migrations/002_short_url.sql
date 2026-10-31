-- forms.gle short link for the student URL (Form.shortenFormUrl), when Google provides one.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS short_url text;
