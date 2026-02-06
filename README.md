# Permafrost

**Understand, analyze, and modernize your Salesforce permission model.**

Permafrost helps Salesforce administrators:

- Trace permission sources for any user (Profile → Permission Set → Permission Set Group)
- Identify redundant and overlapping permissions
- Get recommendations for Permission Set Group consolidation
- Generate comprehensive analysis reports (HTML, Markdown, JSON)
- Plan migration from profile-based to permission set-based security

---

## Prerequisites

- **Node.js** v18+ ([download](https://nodejs.org/))
- **Salesforce CLI** ([install guide](https://developer.salesforce.com/tools/salesforcecli))
- Authenticated Salesforce org (`sf org login web` or `sf org login jwt`)

---

## Installation

### Option 1: Global Install

```bash
npm install -g permafrost
sf-perm --help
```

### Option 2: Local Development

```bash
git clone https://github.com/akj/permafrost
cd permafrost
npm install
npm link  # Makes 'sf-perm' command available globally
```

---

## Quick Start

### 1. Parse Permissions from Your Org

Retrieve and parse all permission metadata into a local database:

```bash
sf-perm parse --org my-sandbox --full
```

The database is stored at `~/.permafrost/<org-username>/permissions.db` by default (org-aware), or specify `--db ./permissions.db` for a local path.

**Options:**

- `--org <alias>` — Salesforce org alias or username
- `--db <path>` — Database file path (default: org-aware path)
- `--metadata-dir <path>` — Where to store retrieved metadata (default: `./metadata`)
- `--full` — Retrieve metadata from org (omit to parse existing metadata only)
- `--force` — Force re-parse even if metadata exists

### 2. Trace Permission Sources

Find where a user gets a specific permission:

```bash
sf-perm trace \
  --user andrew.johnson@example.com \
  --permission Account.Edit \
  --verbose
```

**Example Output:**

```
User: andrew.johnson@example.com
Permission: Account.Edit

✓ Permission granted by 2 source(s):

1. Profile: Standard User
   Value: true

2. PermissionSet: Sales Operations
   → PermissionSetGroup: Sales Team
   → PermissionSet: Sales Operations
   Value: Edit
```

**Options:**

- `-u, --user <email>` — User email, username, or Salesforce ID (required)
- `-p, --permission <name>` — Permission name (required)
- `--format <type>` — Output format: `table` (default) or `json`
- `--verbose` — Show full permission chain (PSG → PS → Permission)

### 3. Analyze Permissions

#### Redundancy Analysis

Identify permissions granted by both Profile and Permission Set, or duplicated across multiple Permission Sets:

```bash
sf-perm analyze redundancy --output redundancy.json
```

#### Overlap Analysis

Find Permission Sets with high similarity (Jaccard coefficient):

```bash
sf-perm analyze overlap --threshold 0.5 --output overlap.json
```

#### Object Access Analysis

See who has access to a specific object:

```bash
sf-perm analyze object --object Account --output object-access.json
sf-perm analyze object --list  # List all objects
```

### 4. Get PSG Recommendations

Get recommendations for Permission Set Group consolidation based on co-assignment patterns:

```bash
sf-perm recommend psg --min-users 5 --output recommendations.json
```

### 5. Generate Reports

Generate a comprehensive analysis report combining all analyses:

```bash
sf-perm report --format html --output report.html
sf-perm report --format markdown --output report.md
sf-perm report --format json --output report.json
```

**Options:**

- `-f, --format <type>` — Report format: `html` (default), `markdown`, `json`
- `--include <types>` — Comma-separated: `redundancy`, `overlap`, `psg`, `object`, `all` (default)

### 6. Export Database

Export the permission database for external analysis:

```bash
sf-perm export --output permissions.json --format json
sf-perm export --output ./export/ --format csv --include profiles,permissionsets
```

---

## Permission Name Format

Use these formats when tracing permissions:

| Permission Type | Format | Example |
|----------------|--------|---------|
| Object CRUD | `Object.Action` | `Account.Edit`, `Contact.Delete` |
| Field-Level Security | `Object.Field` | `Account.Industry`, `Contact.Email` |
| System Permission | Permission name | `ManageUsers`, `ViewAllData` |
| Apex Class | `ApexClass:ClassName` | `ApexClass:MyController` |
| Custom Permission | Custom permission name | `MyCustomPermission` |
| Wildcard | `Object.*` | `Account.*` (all Account permissions) |

---

## Multi-Org Support

Permafrost automatically resolves the database path based on your Salesforce org:

1. If `--org` flag is provided → `~/.permafrost/<username>/permissions.db`
2. If inside an SFDX project with `target-org` configured → uses that org's path
3. Otherwise → falls back to `./permissions.db`

This means you can work with multiple orgs without worrying about overwriting data.

---

## Architecture

```
Salesforce Org
    ↓ (SDR library metadata retrieval + SOQL queries)
Raw Metadata XML + User Assignments
    ↓ (parse command)
SQLite Database (permissions.db)
    ├→ trace   → Permission chain output
    ├→ export  → JSON/CSV
    └→ analyze/recommend/report
        ├→ Redundancy analysis
        ├→ Overlap analysis (Jaccard similarity)
        ├→ PSG recommendations (co-assignment clustering)
        ├→ Object access analysis
        └→ Reports (HTML with Chart.js / Markdown / JSON)
```

**Database Tables:**

- `profiles` — Profile metadata
- `permission_sets` — Permission Set metadata (with `is_owned_by_profile` flag)
- `permission_set_groups` — PSG metadata (only `status='Updated'` are active)
- `psg_members` — PSG → PS membership mapping
- `permissions` — All permissions extracted from profiles/PS
- `user_assignments` — User → Profile/PS/PSG assignments

---

## Use Cases

### Migration Planning: Profile → Permission Sets

1. Parse current state: `sf-perm parse --org my-org --full`
2. Analyze redundancy: `sf-perm analyze redundancy`
3. Get PSG recommendations: `sf-perm recommend psg`
4. Generate report: `sf-perm report --format html`
5. Use report findings to plan migration

### Security Audit

1. Parse org: `sf-perm parse --org production --full`
2. Trace critical permissions: `sf-perm trace -u admin@company.com -p ViewAllData --verbose`
3. Analyze object access: `sf-perm analyze object --object Account`
4. Generate comprehensive report: `sf-perm report --format html`

### Permission Set Consolidation

1. Parse org: `sf-perm parse --org my-org --full`
2. Find overlapping PS: `sf-perm analyze overlap --threshold 0.7`
3. Get consolidation recommendations: `sf-perm recommend psg`

---

## Development

### Project Structure

```
src/
├── index.js                 # CLI entry point (Commander.js)
├── commands/
│   ├── parse.js             # Metadata retrieval & DB population
│   ├── trace.js             # Permission source tracing
│   ├── export.js            # Database export (JSON/CSV)
│   ├── analyze.js           # Analysis subcommands
│   ├── recommend.js         # PSG recommendation
│   └── report.js            # Report generation
├── lib/
│   ├── retriever.js         # Salesforce API wrapper (SDR, SOQL)
│   ├── parser.js            # XML → structured data
│   ├── database.js          # SQLite operations
│   ├── tracer.js            # Permission resolution logic
│   ├── metrics.js           # Set operations (Jaccard, overlap)
│   ├── paths.js             # Org-aware DB path resolution
│   ├── analyzers/
│   │   ├── redundancy.js    # Redundancy detection (4 patterns)
│   │   ├── overlap.js       # PS similarity analysis
│   │   ├── psg-recommender.js # PSG consolidation recommendations
│   │   ├── object-view.js   # Object-centric access reports
│   │   └── report-aggregator.js # Combines analyzer outputs
│   └── reporters/
│       ├── json.js          # JSON output formatter
│       ├── markdown.js      # Markdown output formatter
│       └── html.js          # HTML report with Chart.js
└── templates/
    └── analysis-report.html # HTML report template
```

### Scripts

```bash
npm run dev        # Watch mode
npm run lint       # ESLint check
npm run lint:fix   # Auto-fix lint issues
```

---

## Troubleshooting

### "Cannot find module" errors

```bash
npm install
```

### "Org not found" errors

Ensure you're authenticated:

```bash
sf org list
sf org login web --alias my-sandbox
```

### Empty database after parsing

Ensure `--full` flag is used to retrieve metadata from the org:

```bash
sf-perm parse --org my-sandbox --full
```

---
