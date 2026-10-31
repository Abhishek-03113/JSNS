# Connected MCQ Form Builder (artifact)

Source of the claude.ai artifact https://claude.ai/artifact/7QUfKTat41dyxaz1mBitLP, a copy of the
original MCQ Form Builder (https://claude.ai/artifact/C4FABJbasGdXieEFkRzgiz) with the generated Apps
Script removed. "Make the Google Form" calls this app through the viewer's **MCQ Form Builder**
claude.ai connector (`mcp` capability, tools `get_account`, `create_google_form`,
`list_google_forms`), so the form is made directly and both links come back to the page.

Declared capabilities: `{ sample: {}, mcp: { servers: [{ server: "MCQ Form Builder", tools: [...] }] } }`.
The connector must be named exactly `MCQ Form Builder` in claude.ai.
