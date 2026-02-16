# Permafrost

**Understand, analyze, and modernize your Salesforce permission model.**

Permafrost helps Salesforce administrators:

- Trace permission sources for any user (Profile → Permission Set → Permission Set Group)
- Identify redundant and overlapping permissions
- Get recommendations for Permission Set Group consolidation
- Generate comprehensive analysis reports (HTML, Markdown, JSON)
- Plan migration from profile-based to permission set-based security
- Diff permissions between orgs to identify drift and plan sandbox refreshes

---

## Prerequisites

- **Node.js** v22+ ([download](https://nodejs.org/))
- **Salesforce CLI** ([install guide](https://developer.salesforce.com/tools/salesforcecli))
- Authenticated Salesforce org (`sf org login web` or `sf org login jwt`)

---

## Installation

### Local Development

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
sf-perm parse --org my-sandbox
```

The database is stored at `~/.permafrost/<org-username>/permissions.db` by default (org-aware), or specify `--db ./permissions.db` for a local path.

**Options:**

- `--org <alias>` — Salesforce org alias or username (resolved from SFDX project config if not provided)
- `--db <path>` — Database file path (default: org-aware path)
- `--force` — Force re-parse even if database exists

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

### 4. Validate Permission Dependencies

Check for permission dependency violations (e.g., Edit without Read, ModifyAll without ViewAll):

```bash
sf-perm validate --format table
sf-perm validate --format json --output validation.json
```

**Example Output:**

```
=== Dependency Health Validation ===

Overall Score: 87/100

Violations: 14 total
  Errors: 2
  Warnings: 9
  Info: 3

Sources Analyzed: 47
Sources with Issues: 6

ERRORS (2):

  PermissionSet:Sales_Operations:
    - Has Account.Edit but missing required Account.Read (CRUD_HIERARCHY)
    - Has Contact.Delete but missing required Contact.Read (CRUD_HIERARCHY)
```

**Options:**

- `-f, --format <type>` — Output format: `table` (default) or `json`
- `-o, --output <path>` — Output file path

### 5. Get PSG Recommendations

Get recommendations for Permission Set Group consolidation based on co-assignment patterns:

```bash
sf-perm recommend psg --min-users 5 --output recommendations.json
```

### 6. Generate Reports

Generate a comprehensive analysis report combining all analyses:

```bash
sf-perm report --format html --output report.html
sf-perm report --format markdown --output report.md
sf-perm report --format json --output report.json
```

**Options:**

- `-f, --format <type>` — Report format: `html` (default), `markdown`, `json`
- `--include <types>` — Comma-separated: `redundancy`, `overlap`, `psg`, `dependency`, `object`, `all` (default)

### 7. Export Database

Export the permission database for external analysis:

```bash
sf-perm export --output permissions.json --format json
sf-perm export --output ./export/ --format csv --include profiles,permissionsets
```

### 8. Diff Permissions Between Orgs

Compare permissions across two orgs to identify drift:

```bash
sf-perm diff \
  --source-org andrew.johnson@blindit.org.timeval \
  --target-org andrew.johnson@blindit.org.austinpoc
```

**Example Output:**

```json
{
  "summary": {
    "total_changes": 153,
    "by_operation": {
      "ADD_PERMISSION": 68,
      "REMOVE_PERMISSION": 64,
      "CREATE_PS": 14,
      "CREATE_PSG": 4,
      "ADD_PSG_MEMBER": 3
    }
  }
}
```

Operations describe what would need to change in the **target** to match the **source**:

- `ADD_PERMISSION` / `REMOVE_PERMISSION` — Field, object, user, tab, or record type permission differences
- `CREATE_PS` / `CREATE_PSG` — Permission Sets or Groups that exist in source but not target
- `ADD_PSG_MEMBER` — PSG membership differences

**Options:**

- `--source-org <alias>` — Source org alias or username (required)
- `--target-org <alias>` — Target org alias or username (required)

> **Note:** Both orgs must be parsed first with `sf-perm parse --org <alias>`.

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
    ├→ diff    → Cross-org comparison
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
- `permission_dependencies` — CRUD hierarchy and field-object dependency rules
- `user_assignments` — User → Profile/PS/PSG assignments

---

## Use Cases

### Migration Planning: Profile → Permission Sets

1. Parse current state: `sf-perm parse --org my-org`
2. Analyze redundancy: `sf-perm analyze redundancy`
3. Get PSG recommendations: `sf-perm recommend psg`
4. Generate report: `sf-perm report --format html`
5. Use report findings to plan migration

### Security Audit

1. Parse org: `sf-perm parse --org production`
2. Trace critical permissions: `sf-perm trace -u admin@company.com -p ViewAllData --verbose`
3. Analyze object access: `sf-perm analyze object --object Account`
4. Generate comprehensive report: `sf-perm report --format html`

### Cross-Org Comparison

1. Parse both orgs: `sf-perm parse --org sandbox-a && sf-perm parse --org sandbox-b`
2. Diff permissions: `sf-perm diff --source-org sandbox-a --target-org sandbox-b`
3. Review drift: new/removed permission sets, changed permissions, PSG membership differences

### Permission Set Consolidation

1. Parse org: `sf-perm parse --org my-org`
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
│   ├── validate.js          # Permission dependency health validation
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
│   │   ├── dependency.js    # Permission dependency health
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

Ensure an authenticated org is specified:

```bash
sf-perm parse --org my-sandbox
```

---
